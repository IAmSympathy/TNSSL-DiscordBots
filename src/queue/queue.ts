import {ChannelType, ChatInputCommandInteraction, Client, DMChannel, Message, Message as DiscordMessage, TextChannel, ThreadChannel} from "discord.js";
import {FileMemory} from "../memory/fileMemory";
import {analyzeMessageType} from "../memory/memoryFilter";
import {DISCORD_TYPING_UPDATE_INTERVAL, MEMORY_FILE_PATH, MEMORY_MAX_TURNS} from "../utils/constants";
import {ImageAnalysisResult, processImagesWithMetadata} from "../services/imageService";
import {getWebContext} from "../services/searchService";
import {OllamaService} from "../services/ollamaService";
import {DiscordMessageManager, ImageAnalysisAnimation} from "./discordMessageManager";
import {EmojiReactionHandler} from "./emojiReactionHandler";
import {buildCurrentUserBlock, buildHistoryBlock, buildThreadStarterBlock, buildWebContextBlock} from "./promptBuilder";
import {UserProfileService} from "../services/userProfileService";
import {logBotImageAnalysis, logBotResponse, logBotWebSearch, logError} from "../utils/discordLogger";
import {BotStatus, clearStatus, setStatus} from "../services/statusService";
import {getDMRecentTurns} from "../services/dmMemoryService";
import {createLogger} from "../utils/logger";
import {NETRICSA_USER_ID, NETRICSA_USERNAME, recordNetricsaWebSearch} from "../services/userStatsService";
import {recordAIConversationStats} from "../services/statsRecorder";
import {abortChannelOperations, addUserToQueue, enqueueGlobally, isOperationAborted, isUserInQueue, registerActiveOperation, removeUserFromQueue, unregisterActiveOperation} from "./globalQueue";

// Ré-exporter enqueueGlobally pour les autres services (imageGenerationService)
export {enqueueGlobally} from "./globalQueue";

const wait = require("node:timers/promises").setTimeout;
const logger = createLogger("Queue");

interface DirectLLMRequest {
    prompt: string;
    userId: string;
    userName: string;
    channel: TextChannel | ThreadChannel | DMChannel;
    client: Client;
    replyToMessage?: DiscordMessage;
    referencedMessage?: DiscordMessage;
    imageUrls?: string[];
    sendMessage?: boolean;
    threadStarterContext?: {
        content: string;
        author: string;
        imageUrls: string[];
    };
    skipImageAnalysis?: boolean; // Flag pour indiquer que les images sont déjà analysées
    preAnalyzedImages?: ImageAnalysisResult[]; // Résultats d'analyse pré-calculés
    originalUserMessage?: string; // Message original de l'utilisateur (pour les logs, sans les instructions système)
    preStartedAnimation?: ImageAnalysisAnimation; // Animation déjà démarrée à réutiliser
    skipMemory?: boolean; // Flag pour ne pas enregistrer dans la mémoire (ex: messages de bienvenue)
    returnResponse?: boolean; // Flag pour retourner le contenu final généré
    interaction?: ChatInputCommandInteraction; // Interaction optionnelle pour les messages éphémères
    progressMessage?: Message;
    animationInterval?: NodeJS.Timeout;
    skipTypingIndicator?: boolean; // Flag pour désactiver le typing indicator (UserApps, DMs)
}

// Configuration mémoire persistante
const memory = new FileMemory(MEMORY_FILE_PATH);
const ollamaService = new OllamaService();

// Maps pour gérer les animations et réponses en attente
const activeImageAnalysis = new Map<string, ImageAnalysisAnimation & { userId: string }>();
const pendingResponses = new Map<string, { resolve: (value: string) => void; reject: (error: any) => void }>();

// Fonction pour effacer TOUTE la mémoire globale
export async function clearAllMemory(): Promise<void> {
    await memory.clearAll();
    logger.info(`Global memory cleared (all channels)`);
}

// Fonction pour arrêter un stream en cours (utilise la queue globale)
export function abortStream(channelKey: string, requestingUserId?: string, isAdminOrOwner: boolean = false): boolean {
    return abortChannelOperations(channelKey, requestingUserId, isAdminOrOwner);
}

// Fonction pour enregistrer une animation d'analyse d'image
export function registerImageAnalysis(channelKey: string, animation: ImageAnalysisAnimation, userId: string): void {
    const animationWithUserId = Object.assign({}, animation, {userId});
    activeImageAnalysis.set(channelKey, animationWithUserId);
}

// Fonction pour arrêter une analyse d'image en cours
export async function abortImageAnalysis(channelKey: string, requestingUserId?: string, isAdminOrOwner: boolean = false): Promise<boolean> {
    const animation = activeImageAnalysis.get(channelKey);
    if (animation) {
        // Vérifier si l'utilisateur a le droit d'arrêter cette analyse
        if (!isAdminOrOwner && requestingUserId && animation.userId !== requestingUserId) {
            return false; // Pas autorisé
        }

        await animation.stop();
        activeImageAnalysis.delete(channelKey);
        logger.info(`Image analysis aborted for channel ${channelKey}`);
        return true;
    }
    return false;
}

// Fonction pour nettoyer une animation d'analyse terminée
export function cleanupImageAnalysis(channelKey: string): void {
    activeImageAnalysis.delete(channelKey);
}

// Fonction pour traiter une requête LLM directement (sans thread, pour le watch de channel)
export async function processLLMRequest(request: DirectLLMRequest): Promise<string | void> {
    const {prompt, userId, userName, channel, client, replyToMessage, imageUrls, sendMessage = true, threadStarterContext, skipImageAnalysis = false, preAnalyzedImages = [], originalUserMessage, preStartedAnimation, skipMemory = false, returnResponse = false, interaction, progressMessage, animationInterval, skipTypingIndicator = false} = request;

    // Vérifier si l'utilisateur est déjà dans la queue
    if (isUserInQueue(userId)) {
        logger.info(`User ${userId} (${userName}) tried to add another request while already in queue`);

        // Supprimer le message de l'utilisateur s'il existe
        if (replyToMessage && replyToMessage.deletable) {
            await replyToMessage.delete().catch((err) => logger.error("Failed to delete duplicate message:", err));
        }

        // Envoyer un message éphémère
        if (channel.type !== ChannelType.DM) {
            try {
                // Si on a une interaction, utiliser followUp éphémère
                if (interaction) {
                    await interaction.followUp({
                        content: `Tu es déjà dans la file d'attente. Attends que ta requête actuelle soit terminée.`,
                        ephemeral: true
                    });
                } else {
                    // Sinon, envoyer un message normal et le supprimer après 5 secondes
                    const warningMessage = await channel.send({
                        content: `> ⌛ Tu es déjà dans la file d'attente. Attends que ta requête actuelle soit terminée.`,
                    });
                    setTimeout(() => {
                        warningMessage.delete().catch(() => {
                        });
                    }, 5000);
                }
            } catch (err) {
                logger.error("Failed to send queue warning:", err);
            }
        }
        return;
    }

    // Ajouter l'utilisateur à la queue globale
    addUserToQueue(userId, 'llm');

    // Clé de mémoire unique par channel
    const watchedChannelId = process.env.WATCH_CHANNEL_ID;
    const channelKey = channel.id === watchedChannelId ? watchedChannelId : channel.id;

    // Créer un ID unique pour cette opération
    const operationId = `llm-${userId}-${Date.now()}`;

    // Si returnResponse est demandé, créer une promesse pour attendre le résultat
    let responsePromise: Promise<string> | undefined;
    if (returnResponse) {
        responsePromise = new Promise<string>((resolve, reject) => {
            pendingResponses.set(channelKey, {resolve, reject});
        });
    }

    let currentStatusId: string = "";

    // Mettre en queue globale unique (un seul LLM pour toutes les requêtes)
    enqueueGlobally(async () => {
        const requestStartTime = Date.now();

        // Déterminer le contexte pour le logging
        const GUILD_ID = process.env.GUILD_ID;
        const isExternalServerForLog = interaction && interaction.guild && interaction.guildId !== GUILD_ID;
        const isDMForLog = channel.type === ChannelType.DM;
        const isGroupDMForLog = channel.type === 1; // GroupDM

        let contextLog: string;
        if (isDMForLog) {
            const dmChannel = channel as DMChannel;
            const recipientName = dmChannel.recipient?.displayName || dmChannel.recipient?.username || userName;
            contextLog = `DM avec ${recipientName}`;
        } else if (isGroupDMForLog) {
            contextLog = `Groupe DM${(channel as any).name ? ` (${(channel as any).name})` : ''}`;
        } else if (isExternalServerForLog && interaction?.guild) {
            contextLog = `#${(channel as any).name || channelKey} (Serveur externe: ${interaction.guild.name})`;
        } else {
            contextLog = `#${(channel as any).name || channelKey}`;
        }

        logger.info(`Processing request from user ${userId} in ${contextLog}`);
        logger.info(`User ${userId} sent prompt: ${prompt}${imageUrls && imageUrls.length > 0 ? ` with ${imageUrls.length} image(s)` : ""}`);

        // Enregistrer cette opération comme active
        registerActiveOperation(operationId, 'llm', userId, channel.id);

        // Changer le statut selon l'activité
        if (imageUrls && imageUrls.length > 0 && !skipImageAnalysis) {
            await setStatus(client, imageUrls.length === 1 ? BotStatus.ANALYZING_IMAGE : BotStatus.ANALYZING_IMAGES(imageUrls.length), 60000); // Statut spécifique pour l'analyse d'images, durée plus longue
        }

        // Gérer l'animation d'analyse d'image (seulement si pas déjà analysée et pas skip)
        // Si une animation a déjà été démarrée (par forumThreadHandler), la réutiliser
        let analysisAnimation: ImageAnalysisAnimation;


        if (preStartedAnimation) {
            analysisAnimation = preStartedAnimation;
        } else {
            analysisAnimation = new ImageAnalysisAnimation();
            if (imageUrls && imageUrls.length > 0 && !skipImageAnalysis) {
                await analysisAnimation.start(replyToMessage, channel, interaction);
            }
        }

        // Traiter les images avec métadonnées complètes
        let imageResults: ImageAnalysisResult[] = [];
        let imageDescriptions: string[] = [];

        if (imageUrls && imageUrls.length > 0) {
            try {
                // Si les images sont déjà analysées (depuis forumThreadHandler), utiliser les résultats
                if (skipImageAnalysis && preAnalyzedImages && preAnalyzedImages.length > 0) {
                    logger.info(`Using pre-analyzed images (${preAnalyzedImages.length})`);
                    imageResults = preAnalyzedImages;
                    imageDescriptions = imageResults.map(r => r.description);
                    // Ne pas logger ici, déjà loggé dans forumThreadHandler
                } else if (skipImageAnalysis) {
                    // Skip complètement l'analyse d'images si le flag est true (ex: !s dans le message)
                    logger.info(`Skipping image analysis for ${imageUrls.length} image(s) (!s flag)`);
                    imageDescriptions = imageUrls.map((url, index) => `[Image ${index + 1} - analyse désactivée par l'utilisateur]`);
                } else {
                    // Sinon, analyser les images normalement
                    imageResults = await processImagesWithMetadata(imageUrls);
                    imageDescriptions = imageResults.map(r => r.description);

                    // Logger l'analyse d'images avec toutes les métadonnées
                    if (imageResults.length > 0) {
                        const user = await client.users.fetch(userId).catch(() => null);
                        const avatarUrl = user?.displayAvatarURL();
                        await logBotImageAnalysis(userName, imageResults, avatarUrl);
                    }
                }
            } catch (imageError) {
                logger.error("Error during image analysis:", imageError);
                // En cas d'erreur (timeout, etc.), créer des descriptions fallback
                imageDescriptions = imageUrls.map((url, index) => `[Image ${index + 1} - erreur lors de l'analyse]`);
            } finally {
                // Arrêter l'animation d'analyse d'image dans tous les cas (succès ou erreur)
                await analysisAnimation.stop();
                logger.info("Image analysis animation stopped");
                // NE PAS supprimer le message - il sera réutilisé par le messageManager
            }
        }

        // Traiter les images du thread starter si présent
        let threadStarterImageDescriptions: string[] = [];
        if (threadStarterContext && threadStarterContext.imageUrls.length > 0) {
            logger.info(`Processing ${threadStarterContext.imageUrls.length} image(s) from thread starter`);
            const threadImageResults = await processImagesWithMetadata(threadStarterContext.imageUrls);
            threadStarterImageDescriptions = threadImageResults.map(r => r.description);

            if (threadImageResults.length > 0) {
                // Récupérer l'avatar de l'utilisateur
                const user = await client.users.fetch(userId).catch(() => null);
                const avatarUrl = user?.displayAvatarURL();
                await logBotImageAnalysis(`${userName} (thread starter)`, threadImageResults, avatarUrl);
            }
        }

        // Déterminer le type de canal et le contexte
        const isDM = channel.type === ChannelType.DM;
        const isGroupDM = channel.type === 1; // GroupDM typ

        // Déterminer si c'est un serveur externe (UserApp utilisé dans un serveur où le bot n'est pas installé)
        // GUILD_ID déjà déclaré au début de la fonction
        const isExternalServer = interaction && interaction.guild && interaction.guildId !== GUILD_ID;

        // Charger les prompts système avec le contexte approprié (DM ou serveur)
        const {finalPrompt: finalSystemPrompt} = ollamaService.loadSystemPrompts(channel.id, isDM);

        // Charger la mémoire appropriée (sauf si skipMemory est activé)
        let recentTurns: any[];

        if (skipMemory) {
            // Ne pas charger de mémoire
            recentTurns = [];
            logger.info(`Memory skipped (skipMemory flag)`);
        } else if (isDM || isGroupDM) {
            // Charger la mémoire DM de l'utilisateur (même pour GroupDM)
            recentTurns = await getDMRecentTurns(userId, MEMORY_MAX_TURNS);
            logger.info(`${recentTurns.length} DM turns loaded for ${userName}`);
        } else {
            // Charger l'historique de mémoire GLOBAL avec Sliding Window
            recentTurns = await memory.getRecentTurns(MEMORY_MAX_TURNS);
            logger.info(`${recentTurns.length} turns loaded (Sliding Window active)`);
        }

        // Obtenir le contexte web si nécessaire
        const webSearchStartTime = Date.now();

        // Détecter si une recherche web est nécessaire
        const needsWebSearch = prompt.toLowerCase().includes("recherche") ||
            prompt.toLowerCase().includes("google") ||
            prompt.toLowerCase().includes("cherche") ||
            prompt.includes("?");

        const webContext = await getWebContext(prompt);
        if (webContext) {
            const webSearchTime = Date.now() - webSearchStartTime;
            logger.info(`Web context added to prompt (${webSearchTime}ms)`);

            // Logger la recherche web avec le temps
            const user = await client.users.fetch(userId).catch(() => null);
            const avatarUrl = user?.displayAvatarURL();
            await logBotWebSearch(userName, prompt, webContext.facts?.length || 0, webSearchTime, avatarUrl);

            // Enregistrer la recherche web uniquement pour Netricsa elle-même
            recordNetricsaWebSearch();

            // Tracker la recherche web pour la mission imposteur
            const {trackImpostorWebSearch} = require("../services/events/impostorMissionTracker");
            await trackImpostorWebSearch(client, userId);
        }

        // Récupérer le profil de l'utilisateur actuel
        const userProfileSummary = UserProfileService.getProfileSummary(userId);
        let userProfileBlock = "";
        if (userProfileSummary) {
            userProfileBlock = `\n\n═══ PROFIL DE L'UTILISATEUR ACTUEL: ${userName.toUpperCase()} (UID Discord: ${userId}) ═══\n⚠️ Ce profil appartient à la personne qui t'envoie le message actuel.\n${userProfileSummary}\n═══ FIN DU PROFIL DE ${userName.toUpperCase()} ═══`;
            logger.info(`Profile loaded for ${userName}`);
        }

        // Obtenir le nom du channel actuel avec détection du contexte
        let channelName: string;

        if (isDM) {
            // Pour un DM 1-1, récupérer le nom du destinataire
            const dmChannel = channel as DMChannel;
            const recipientName = dmChannel.recipient?.displayName || dmChannel.recipient?.username || userName;
            channelName = `DM avec ${recipientName}`;
        } else if (isGroupDM) {
            // Pour un groupe DM
            channelName = `Groupe DM${(channel as any).name ? ` (${(channel as any).name})` : ''}`;
        } else if (isExternalServer && interaction?.guild) {
            // UserApp utilisé dans un serveur externe
            const guildName = interaction.guild.name;
            const channelNameInGuild = (channel as any).name || 'canal-inconnu';
            channelName = `#${channelNameInGuild} (Serveur externe: ${guildName})`;
        } else {
            // Serveur normal
            channelName = (channel as any).name || `channel-${channel.id}`;
        }

        // Construire les blocs de prompt
        const threadStarterBlock = threadStarterContext ? buildThreadStarterBlock(threadStarterContext, threadStarterImageDescriptions) : "";
        const historyBlock = buildHistoryBlock(recentTurns, channel.id);
        const webBlock = buildWebContextBlock(webContext);
        const currentUserBlock = buildCurrentUserBlock(userId, userName, prompt, imageDescriptions, recentTurns);

        // Assembler les messages pour l'API
        // Le thread starter va EN PREMIER, avant l'historique
        // Le profil utilisateur vient après le reste
        const messages = [
            {
                role: "system" as const,
                content: `${finalSystemPrompt}${userProfileBlock}\n\n${threadStarterBlock}${webBlock}${historyBlock.length > 0 ? `\n\n${historyBlock}` : ""}`,
            },
            {
                role: "user" as const,
                content: currentUserBlock,
            },
        ];

        if (imageDescriptions.length > 0) {
            logger.info(`${imageDescriptions.length} image description(s) included in context`);
        }

        // Changer le statut à "écrit"
        await setStatus(client, BotStatus.WRITING);

        // Démarrer l'indicateur "est en train d'écrire" de Discord
        // SAUF si skipTypingIndicator est activé (UserApps, DMs sans accès)
        let typingInterval: NodeJS.Timeout | null = null;
        if (!skipTypingIndicator) {
            try {
                // Envoyer l'indicateur immédiatement
                await channel.sendTyping();
                // Renouveler toutes les 5 secondes (l'indicateur expire après 10 secondes)
                typingInterval = setInterval(async () => {
                    try {
                        await channel.sendTyping();
                    } catch (error) {
                        // Ignorer les erreurs (canal supprimé, etc.)
                    }
                }, 5000);
            } catch (error) {
                logger.warn("Could not send typing indicator:", error);
            }
        } else {
            logger.info("Typing indicator skipped (skipTypingIndicator = true)");
        }

        logger.info(`Sending request to Ollama`);

        let loadingTimeout: NodeJS.Timeout | null = null; // Déclarer ici pour accès dans catch

        try {
            // TWO-STEP APPROACH :
            // 1. Première requête : Générer la réponse SANS tools (pour garantir une réponse textuelle)
            // 2. Deuxième requête : Analyser avec tools en arrière-plan pour extraire les infos
            const response = await ollamaService.chat(messages, {}, true, undefined); // Pas de tools pour la première requête
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let result = "";

            // Gestionnaires
            const messageManager = new DiscordMessageManager(channel, replyToMessage, interaction);

            // Si un progressMessage est fourni (comme /ask-netricsa), l'utiliser
            if (progressMessage) {
                messageManager.setProgressMessage(progressMessage);
                logger.info("Using provided progressMessage for response");

                // Arrêter l'animation fournie car le messageManager va éditer le message
                if (animationInterval) {
                    clearInterval(animationInterval);
                    logger.info("Stopped provided animationInterval");
                }
            }

            // Toujours passer l'animation au messageManager (pour les cas normaux)
            // - Si l'animation a été utilisée pour l'analyse d'images, elle sera réutilisée pour le premier message
            // - Si c'est une interaction, l'animation n'a pas été créée (skip) donc pas de réutilisation
            messageManager.setAnalysisAnimation(analysisAnimation);

            // Configurer le callback pour arrêter le typing indicator dès le premier message envoyé
            messageManager.setOnFirstMessageSent(() => {
                if (typingInterval) {
                    clearInterval(typingInterval);
                    typingInterval = null;
                    logger.info("Typing indicator stopped (first message sent)");
                }
            });

            const emojiHandler = new EmojiReactionHandler(replyToMessage);

            let jsonBuffer = "";
            let promptTokens = 0;
            let completionTokens = 0;
            let totalTokens = 0;
            let toolCalls: any[] = []; // Stocker les tool calls (pour la 2e requête)
            let firstChunkReceived = false; // Flag pour détecter le premier chunk
            let loadingMessageSent = false; // Flag pour le message de chargement

            // Timeout pour détecter si le modèle met trop de temps à répondre (rechargement)
            loadingTimeout = setTimeout(async () => {
                if (!firstChunkReceived && !loadingMessageSent && sendMessage) {
                    loadingMessageSent = true;
                    logger.info("Model loading detected (5s without first chunk), sending loading message...");
                    try {
                        const loadingMsg = await channel.send("⏳ Chargement du modèle en cours...");
                        // Supprimer le message une fois que le modèle répond
                        setTimeout(() => {
                            loadingMsg.delete().catch(() => {
                            });
                        }, 30000); // Supprimer après 30s max
                    } catch (err) {
                        logger.warn("Could not send loading message:", err);
                    }
                }
            }, 5000); // Attendre 5 secondes avant d'afficher le message

            // Pour les interactions, on désactive le throttling (on enverra tout d'un coup à la fin)
            // Pour les messages normaux, on garde le throttling pour la mise à jour en temps réel
            let throttleResponseInterval: NodeJS.Timeout | null = null;
            if (!interaction) {
                throttleResponseInterval = setInterval(() => {
                    if (sendMessage) {
                        messageManager.throttleUpdate().catch((err) => logger.error("[Throttle] Update error:", err));
                    }
                }, DISCORD_TYPING_UPDATE_INTERVAL);
            } else {
                logger.info("Interaction detected - streaming disabled, will send complete message at the end");
            }


            return new ReadableStream({
                start(controller) {
                    return pump();

                    function pump(): any {
                        return reader?.read().then(async function ({done, value}) {
                            if (isOperationAborted(operationId)) {
                                logger.info(`Stream aborted by user for channel ${channelKey}`);
                                if (throttleResponseInterval) clearInterval(throttleResponseInterval);
                                if (typingInterval) clearInterval(typingInterval);
                                if (animationInterval) clearInterval(animationInterval);
                                await analysisAnimation.stop();
                                unregisterActiveOperation(operationId);

                                // Retirer l'utilisateur de la queue lors de l'annulation
                                removeUserFromQueue(userId);

                                controller.close();
                                return;
                            }

                            if (done) {
                                logger.info(`Request complete for user ${userId}`);

                                // Nettoyer le timeout de chargement
                                if (loadingTimeout) clearTimeout(loadingTimeout);

                                if (totalTokens > 0) {
                                    logger.info(`Tokens - Prompt: ${promptTokens} | Completion: ${completionTokens} | Total: ${totalTokens}`);
                                }

                                await wait(2000);

                                // Pour les interactions, envoyer le message complet d'un coup
                                if (interaction && sendMessage) {
                                    logger.info("Sending complete message for interaction (no streaming)");
                                    messageManager.addToCurrentChunk(result);
                                    await messageManager.throttleUpdate(true); // Force=true pour envoyer même si < 20 chars
                                } else if (sendMessage) {
                                    // Pour les messages normaux, finaliser ou créer le message
                                    if (messageManager.hasMessages()) {
                                        // Des messages ont été créés pendant le streaming, les finaliser
                                        await messageManager.finalizeLastMessage();
                                    } else {
                                        // Aucun message créé (réponse courte < 20 chars), créer maintenant
                                        logger.info("No messages created during streaming, creating final message now");
                                        const cleanedResult = await emojiHandler.extractAndApply(result);
                                        messageManager.addToCurrentChunk(cleanedResult);
                                        await messageManager.throttleUpdate(true); // Force=true pour envoyer même si < 20 chars
                                    }
                                }

                                // Nettoyer et sauvegarder
                                const cleanedText = await emojiHandler.extractAndApply(result);
                                const isModerationRefusal =
                                    cleanedText.toLowerCase().includes("je suis désolée") ||
                                    cleanedText.toLowerCase().includes("je ne peux pas répondre") ||
                                    cleanedText.toLowerCase().includes("je ne répondrai pas");

                                // Vérifier qu'il y a du texte en plus de l'emoji
                                const hasTextContent = cleanedText.trim().length > 0;

                                if (!hasTextContent) {
                                    logger.warn(`⚠️ No text content after emoji extraction, skipping message send`);
                                }

                                if (sendMessage && hasTextContent && !isModerationRefusal) {
                                    // Récupérer les réactions appliquées
                                    const appliedEmojis = emojiHandler.getAppliedEmojis();
                                    const reactionEmoji = appliedEmojis.length > 0 ? appliedEmojis[0] : undefined;

                                    // Calculer le temps de réponse total
                                    const responseTime = Date.now() - requestStartTime;

                                    // Tous les messages avec réponse sont stockés (le filtrage se fait dans slidingWindowMemory)
                                    const willSaveInMemory = true;

                                    // Logger la réponse de Netricsa avec l'info de mémoire
                                    const user = await client.users.fetch(userId).catch(() => null);
                                    const avatarUrl = user?.displayAvatarURL();
                                    await logBotResponse(
                                        userName,
                                        userId,
                                        channelName,
                                        originalUserMessage || prompt, // Utiliser le message original si fourni, sinon le prompt complet
                                        cleanedText,
                                        totalTokens,
                                        imageDescriptions.length > 0,
                                        webContext !== null,
                                        reactionEmoji,
                                        responseTime,
                                        willSaveInMemory,
                                        avatarUrl
                                    );
                                    if (willSaveInMemory && !skipMemory) {
                                        // Utiliser le message original pour l'analyse du type
                                        const messageToAnalyze = originalUserMessage || prompt;
                                        const messageType = analyzeMessageType(messageToAnalyze);

                                        // Détecter si c'est un reply
                                        const isReply = !!replyToMessage?.reference?.messageId;

                                        await memory.appendTurn(
                                            {
                                                ts: Date.now(),
                                                discordUid: userId,
                                                displayName: userName,
                                                channelId: channel.id,
                                                channelName: channelName,
                                                userText: originalUserMessage || prompt, // Utiliser le message original sans contexte
                                                assistantText: cleanedText,
                                                ...(imageDescriptions.length > 0 ? {imageDescriptions: imageDescriptions.slice(0, 5)} : {}),
                                                ...(webContext ? {webContext} : {}),
                                            },
                                            MEMORY_MAX_TURNS
                                        );

                                        const contextInfo = [];
                                        if (imageDescriptions.length > 0) contextInfo.push("images");
                                        if (emojiHandler.getAppliedEmojis().length > 0) contextInfo.push("reactions");
                                        if (messageType.confidence > 0.7) contextInfo.push(`type:${messageType.type}`);
                                        if (isReply) contextInfo.push("reply");

                                        logger.info(`✅ Saved in #${channelName}${contextInfo.length > 0 ? ` [${contextInfo.join(", ")}]` : ""}`);
                                    }

                                    // Enregistrer la conversation IA pour l'utilisateur
                                    recordAIConversationStats(userId, userName);

                                    // Enregistrer la conversation IA pour Netricsa elle-même
                                    recordAIConversationStats(NETRICSA_USER_ID, NETRICSA_USERNAME);

                                    // Ajouter XP avec notification pour l'utilisateur (conversation IA inclut les recherches web)
                                    const {addXP, XP_REWARDS} = require("../services/xpSystem");
                                    await addXP(userId, userName, XP_REWARDS.conversationIA, channel, false);
                                } else if (isModerationRefusal) {
                                    logger.warn(`🚫 Moderation refusal detected, NOT saving to memory`);
                                }

                                // Réinitialiser le statut
                                await clearStatus(client);

                                unregisterActiveOperation(operationId);
                                if (throttleResponseInterval) clearInterval(throttleResponseInterval);
                                if (typingInterval) clearInterval(typingInterval);
                                if (animationInterval) clearInterval(animationInterval);
                                controller.close();

                                // Retirer l'utilisateur de la queue
                                removeUserFromQueue(userId);

                                // Résoudre la promesse avec le contenu si demandé
                                const pending = pendingResponses.get(channelKey);
                                if (pending) {
                                    pending.resolve(cleanedText);
                                    pendingResponses.delete(channelKey);
                                }
                                return;
                            }

                            jsonBuffer += decoder.decode(value, {stream: true});
                            const lines = jsonBuffer.split("\n");
                            jsonBuffer = lines.pop() || "";

                            for (const line of lines) {
                                if (!line.trim()) continue;

                                if (process.env.DEBUG_OLLAMA_RAW === "1") {
                                    logger.info("[Ollama Raw Line]", line);
                                }

                                let decodedChunk: any;
                                try {
                                    decodedChunk = JSON.parse(line);
                                } catch (parseError) {
                                    logger.error("JSON parse error:", parseError);
                                    continue;
                                }

                                const chunk = decodedChunk.message?.delta || decodedChunk.message?.content || "";

                                // Détecter les tool calls
                                if (decodedChunk.message?.tool_calls && decodedChunk.message.tool_calls.length > 0) {
                                    toolCalls.push(...decodedChunk.message.tool_calls);
                                    logger.info(`Detected ${decodedChunk.message.tool_calls.length} tool call(s)`);
                                }

                                if (decodedChunk.prompt_eval_count) promptTokens = decodedChunk.prompt_eval_count;
                                if (decodedChunk.eval_count) completionTokens = decodedChunk.eval_count;
                                if (promptTokens && completionTokens) totalTokens = promptTokens + completionTokens;

                                result += chunk;

                                // Pour les interactions, on accumule sans envoyer (pas de streaming)
                                // Pour les messages normaux, on met à jour les chunks en temps réel
                                if (!interaction) {
                                    const cleanedResult = await emojiHandler.extractAndApply(result);
                                    messageManager.addToCurrentChunk(cleanedResult);

                                    // Envoyer le premier message immédiatement pour arrêter le typing indicator
                                    if (!firstChunkReceived && sendMessage && cleanedResult.trim().length > 0) {
                                        firstChunkReceived = true;
                                        if (loadingTimeout) clearTimeout(loadingTimeout); // Annuler le timeout de chargement
                                        await messageManager.throttleUpdate().catch((err) => logger.error("[FirstChunk] Update error:", err));
                                    }
                                } else {
                                    // Pour les interactions, juste nettoyer le timeout si on reçoit le premier chunk
                                    if (!firstChunkReceived) {
                                        firstChunkReceived = true;
                                        if (loadingTimeout) clearTimeout(loadingTimeout);
                                    }
                                }
                            }

                            controller.enqueue(value);
                            return pump();
                        });
                    }
                },
            });
        } catch (error) {
            logger.error("Error processing LLM request:", error);

            // Vérifier si c'est une erreur de connexion aux services locaux
            const isConnectionError = error instanceof Error && error.message.includes('CONNECTION_ERROR');

            if (isConnectionError) {
                logger.error("🌙 Connection error detected - activating Standby Mode");
                // Importer et activer le mode Standby
                const {handleConnectionError} = require('../services/standbyModeService');
                await handleConnectionError(client);
            }

            // Nettoyer le timeout de chargement
            if (loadingTimeout) clearTimeout(loadingTimeout);

            // Retirer l'utilisateur de la queue en cas d'erreur
            removeUserFromQueue(userId);
            unregisterActiveOperation(operationId);

            // Arrêter l'indicateur typing
            if (typingInterval) clearInterval(typingInterval);
            if (animationInterval) clearInterval(animationInterval);

            // Réinitialiser le statut spécifique en cas d'erreur
            await clearStatus(client, currentStatusId);

            // Rejeter la promesse en cas d'erreur
            const pending = pendingResponses.get(channelKey);
            if (pending) {
                pending.reject(error);
                pendingResponses.delete(channelKey);
            }

            await logError("Erreur de traitement LLM", undefined, [
                {name: "Utilisateur", value: userName, inline: true},
                {name: "Canal", value: (channel as any).name || channel.type === ChannelType.DM ? "DM" : "Thread", inline: true},
                {name: "Erreur", value: error instanceof Error ? error.message : String(error)}
            ]);

            // Message d'erreur adapté selon le type d'erreur
            const errorMessage = isConnectionError
                ? "💤 Je ne peux pas me connecter à l'ordinateur de mon créateur. Je passe en **mode veille** et vérifierai régulièrement quand il sera de nouveau disponibles."
                : "An error occurred while processing your message.";

            if (replyToMessage) {
                await replyToMessage.reply(errorMessage);
            } else {
                await channel.send(errorMessage);
            }
        }
    });

    // Retourner la promesse si returnResponse est demandé
    return responsePromise;
}
