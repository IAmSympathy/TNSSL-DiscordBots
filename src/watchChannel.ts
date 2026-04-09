import {ChannelType, Client, DMChannel, Message, TextChannel} from "discord.js";
import {processLLMRequest} from "./queue/queue";
import {setBotPresence} from "./bot";
import {generateMentionEmoji} from "./services/emojiService";
import {collectAllMediaUrls} from "./services/gifService";
import {updateUserActivityFromPresence} from "./services/activityService";
import {createLowPowerEmbed, createStandbyEmbed, logBotReaction} from "./utils/discordLogger";
import {BotStatus, clearStatus, setStatus} from "./services/statusService";
import {isLowPowerMode} from "./services/botStateService";
import {isStandbyMode} from "./services/standbyModeService";
import {appendDMTurn, getDMRecentTurns} from "./services/dmMemoryService";
import {EnvConfig} from "./utils/envConfig";
import {createLogger} from "./utils/logger";
import {NETRICSA_USER_ID, NETRICSA_USERNAME, recordEmojisUsed} from "./services/userStatsService";
import {recordAIConversationStats, recordMentionReceivedStats, recordMessageStats, recordReactionAddedStats, recordReplyReceivedStats} from "./services/statsRecorder";
import {addXP, XP_REWARDS} from "./services/xpSystem";
import {handleCounterMessage} from "./services/counterService";
import {tryRewardAndNotify} from "./services/rewardNotifier";
import {createDMNotMemberErrorEmbed, isUserInRequiredServerFromDM} from "./utils/serverMembershipCheck";

const logger = createLogger("WatchChannel");

function isWatchedChannel(message: Message, watchedChannelId?: string): boolean {
    return !!watchedChannelId && message.channelId === watchedChannelId;
}

/**
 * Gère les modes Standby et Low Power avec embeds et suppression automatique
 * Retourne true si un mode est actif et a été géré
 */
async function handleBotModes(message: Message, client: Client, watchedChannelId?: string): Promise<boolean> {
    const isDM = message.channel.type === ChannelType.DM;

    // Vérifier si en Standby Mode (prioritaire)
    if (isStandbyMode(client)) {
        // En DM, toujours répondre. En serveur, vérifier mention ou canal surveillé
        const shouldRespond = isDM ||
            (message.mentions.has(client.user!.id) && !message.mentions.everyone) ||
            isWatchedChannel(message, watchedChannelId);

        if (shouldRespond) {
            const errorEmbed = createStandbyEmbed(
                "Mode Veille",
                "Netricsa est en mode veille, car elle ne peut se connecter à l'ordinateur de son créateur. La conversation intelligente n'est pas disponible pour le moment."
            );
            const reply = await message.reply({embeds: [errorEmbed]});
            logger.info(`${isDM ? '[DM] ' : ''}Standby Mode - sent message to ${message.author.username}`);

            // Supprimer les messages après 10 secondes
            setTimeout(async () => {
                try {
                    await message.delete().catch(() => {
                    });
                    await reply.delete().catch(() => {
                    });
                    logger.debug(`${isDM ? '[DM] ' : ''}Deleted Standby Mode messages after 10s`);
                } catch (error) {
                    logger.debug(`${isDM ? '[DM] ' : ''}Could not delete Standby Mode messages: ${error}`);
                }
            }, 10000);
        }
        return true; // Mode actif
    }

    // Vérifier si en Low Power Mode
    if (isLowPowerMode()) {
        // En DM, toujours répondre. En serveur, vérifier mention ou canal surveillé
        const shouldRespond = isDM ||
            (message.mentions.has(client.user!.id) && !message.mentions.everyone) ||
            isWatchedChannel(message, watchedChannelId);

        if (shouldRespond) {
            const errorEmbed = createLowPowerEmbed(
                "Mode Économie d'Énergie",
                "Netricsa est en mode économie d'énergie, car l'ordinateur de son créateur priorise les performances pour d'autres tâches. La conversation intelligente n'est pas disponible pour le moment."
            );
            const reply = await message.reply({embeds: [errorEmbed]});
            logger.info(`${isDM ? '[DM] ' : ''}Low Power Mode - sent message to ${message.author.username}`);

            // Supprimer les messages après 10 secondes
            setTimeout(async () => {
                try {
                    await message.delete().catch(() => {
                    });
                    await reply.delete().catch(() => {
                    });
                    logger.debug(`${isDM ? '[DM] ' : ''}Deleted Low Power Mode messages after 10s`);
                } catch (error) {
                    logger.debug(`${isDM ? '[DM] ' : ''}Could not delete Low Power Mode messages: ${error}`);
                }
            }, 10000);
        }
        return true; // Mode actif
    }

    return false; // Aucun mode actif
}

/**
 * Extrait les informations sur les utilisateurs mentionnés dans le message
 * et retourne un contexte formaté pour l'IA
 */function extractMentionContext(message: Message, client: Client): string {
    if (message.mentions.users.size === 0) return "";

    const mentionedUsers: string[] = [];
    message.mentions.users.forEach((user) => {
        // Exclure le bot lui-même des mentions
        if (user.id === client.user?.id) return;

        const displayName = user.displayName || user.username;
        mentionedUsers.push(`@${displayName} (Username: ${user.username}, UID: ${user.id})`);
    });

    // Si aucun utilisateur (sauf le bot) n'a été mentionné, ne pas ajouter de contexte
    if (mentionedUsers.length === 0) return "";

    return `\n[UTILISATEURS MENTIONNÉS DANS CE MESSAGE]\n${mentionedUsers.join("\n")}\n[Si l'information concerne une personne mentionnée, utilise SON UID, pas celui de ${message.author.displayName}]\n\n`;
}

async function handleNettieReaction(client: Client, message: Message): Promise<string> {
    logger.info(`Message from ${message.author.username} talks about Nettie`);
    const statusId = await setStatus(client, BotStatus.CHOOSING_REACTION);

    try {
        const emoji = await generateMentionEmoji(message.content);
        await message.react(emoji);
        logger.info(`Reacted with: ${emoji}`);

        // Enregistrer la réaction de Netricsa dans les stats
        recordReactionAddedStats(NETRICSA_USER_ID, NETRICSA_USERNAME);

        await clearStatus(client, statusId);
        return emoji;
    } catch (error) {
        logger.error("Failed to get emoji from LLM:", error);
        await clearStatus(client, statusId);
        await message.react("🤗");

        // Enregistrer la réaction de fallback de Netricsa
        recordReactionAddedStats(NETRICSA_USER_ID, NETRICSA_USERNAME);

        return "🤗";
    }

}

async function getThreadStarterMessage(thread: any) {
    try {
        // Utiliser la méthode officielle Discord.js pour récupérer le message starter
        const starterMessage = await thread.fetchStarterMessage();
        return starterMessage;
    } catch (error) {
        logger.warn("Failed to fetch thread starter message:", error);
        return null;
    }
}

interface ReferencedMessageContext {
    contextPrompt: string;
    imageUrls: string[];
    referencedMessage: Message;
    mustReact: boolean;
}

async function extractReferencedMessageContext(message: Message, messageReferenceId: string, forumChannelId?: string): Promise<ReferencedMessageContext | null> {
    try {
        const referencedMessage = await message.channel.messages.fetch(messageReferenceId);

        // Si le message référencé est du bot lui-même, ne pas ajouter de contexte car il est déjà dans l'historique
        const isBotMessage = referencedMessage.author.bot;

        logger.info(`Fetching referenced message from ${referencedMessage.author.displayName}`);
        logger.info(`Referenced message content: "${referencedMessage.content}"`);
        logger.info(`Referenced message has ${referencedMessage.attachments.size} attachment(s)`);

        // Collecter tous les médias (images + GIFs + Tenor)
        const imageUrls = await collectAllMediaUrls(referencedMessage);

        logger.info(`Collected ${imageUrls.length} media URL(s) from referenced message:`, imageUrls);

        let mustReact = false;
        if (message.channel.isThread() && forumChannelId) {
            const thread = message.channel;
            if (thread.parent?.type === ChannelType.GuildForum && thread.parent.id === forumChannelId) {
                const firstMessage = await getThreadStarterMessage(thread);
                if (firstMessage && firstMessage.id === referencedMessage.id) {
                    mustReact = true;
                    logger.info(`Detected reply to original post in Création forum - must react`);
                }
            }
        }

        // Si c'est un message du bot, retourner seulement les images et mustReact, sans ajouter de contexte textuel
        if (isBotMessage) {
            logger.info(`Message references bot's own message - skipping context (already in history)`);
            return {
                contextPrompt: "",
                imageUrls,
                referencedMessage,
                mustReact
            };
        }

        // Pour les messages d'autres utilisateurs, ajouter le contexte complet
        const refAuthor = referencedMessage.author.displayName || referencedMessage.author.username;
        const refContent = referencedMessage.content || "[message sans texte]";
        const refImageNotice = imageUrls.length > 0 ? ` [contient ${imageUrls.length} média(s)]` : "";
        const contextPrompt = `[L'utilisateur répond au message suivant]\n${refAuthor}: ${refContent}${refImageNotice}\n\n[Réponse de l'utilisateur]\n`;

        logger.info(`Message references another message from ${refAuthor}${refImageNotice}`);

        return {contextPrompt, imageUrls, referencedMessage, mustReact};
    } catch (error) {
        logger.warn("Failed to fetch referenced message:", error);
        return null;
    }
}

export function registerWatchedChannelResponder(client: Client) {
    const watchedChannelId = EnvConfig.WATCH_CHANNEL_ID;
    const forumChannelId = EnvConfig.FORUM_CHANNEL_ID;

    if (watchedChannelId) {
        logger.info(`Watching channel: ${watchedChannelId}`);
    }

    logger.info(`Bot mention detection enabled in all channels`);

    client.on("messageCreate", async (message) => {
        try {
            // Ne plus ignorer complètement les bots - ils peuvent aussi gagner de l'XP
            // Mais on évite les réponses automatiques du bot lui-même pour éviter les boucles

            // Vérifier si c'est un événement de boss (mini boss ou boss), riddle ou sequence
            if (!message.author.bot) {
                const {handleMiniBossMessage} = require("./services/events/miniBossEvent");
                const {handleBossMessage} = require("./services/events/bossEvent");
                const {handleRiddleMessage} = require("./services/events/riddleEvent");
                const {handleSequenceMessage} = require("./services/events/sequenceEvent");

                await handleMiniBossMessage(client, message);
                await handleBossMessage(client, message);
                await handleRiddleMessage(client, message);
                await handleSequenceMessage(client, message);
            }

            // Vérifier si c'est le salon compteur
            const COUNTER_CHANNEL_ID = EnvConfig.COUNTER_CHANNEL_ID;
            const MUSIC_CHANNEL_ID = EnvConfig.NEXA_MUSIC_CHANNEL_ID;
            if (COUNTER_CHANNEL_ID && message.channelId === COUNTER_CHANNEL_ID && !message.author.bot && message.channelId !== MUSIC_CHANNEL_ID) {
                // Gérer le message du compteur (validera et supprimera si invalide)
                const isValid = await handleCounterMessage(message);

                // Si le message est valide, donner très peu d'XP (1 XP seulement)
                // NE PAS enregistrer dans les stats de messages (ça fausserait les statistiques)
                if (isValid) {
                    await addXP(
                        message.author.id,
                        message.author.username,
                        1, // 1 XP seulement pour le compteur
                        message.channel as TextChannel,
                        false
                    );
                }

                // Chance d'obtenir un objet saisonnier (0.8% par minute vocale)
                const {tryRewardAndNotify} = require("./services/rewardNotifier");
                await tryRewardAndNotify(null, message.channel as any, message.author.id, message.author.username, "message");

                // Ne pas continuer le traitement normal pour les messages du compteur
                // Pas de mémoire, pas de réponse aux mentions, rien
                return;
            }

            // Si c'est un bot qui essaie de mentionner Netricsa dans le compteur, ignorer aussi
            if (COUNTER_CHANNEL_ID && message.channelId === COUNTER_CHANNEL_ID) {
                return;
            }

            // Vérifier si c'est un salon d'événement de boss (ne pas compter dans les stats)
            const {loadEventsData} = require("./services/events/eventsDataManager");
            const {EventType} = require("./services/events/eventTypes");
            const eventsData = loadEventsData();
            const isBossEventChannel = eventsData.activeEvents.some((e: any) =>
                (e.type === EventType.MINI_BOSS || e.type === EventType.BOSS) &&
                e.channelId === message.channelId
            );
            if (isBossEventChannel) {
                return;
            }

            // Ne pas enregistrer les stats pour les webhooks
            if (!message.webhookId) {
                // Enregistrer le message envoyé dans les statistiques
                recordMessageStats(message.author.id, message.author.username);
                // Enregistrer les emojis utilisés dans le message
                recordEmojisUsed(message.author.id, message.author.username, message.content);

                // Tracker la mission imposteur si l'utilisateur est un imposteur actif
                const {trackImpostorMessage} = require("./services/events/impostorMissionTracker");
                const mentionedUsers = message.mentions.users.filter(u => !u.bot).map(u => u.id);
                await trackImpostorMessage(message.client, message.author.id, message.content, mentionedUsers);

                // Vérifier les achievements Discord (messages, emojis, spéciaux)
                const {checkDiscordAchievements, checkTimeBasedAchievements, checkBirthdayAchievement} = require("./services/discordAchievementChecker");
                await checkDiscordAchievements(message.author.id, message.author.username, message.client, message.channelId);
                await checkTimeBasedAchievements(message.author.id, message.author.username, message.client, message.channelId);
                await checkBirthdayAchievement(message.author.id, message.author.username, message.client, message.channelId);

                // Ajouter XP (la fonction détecte automatiquement si c'est un bot)
                await addXP(
                    message.author.id,
                    message.author.username,
                    XP_REWARDS.messageEnvoye,
                    message.channel as TextChannel,
                    message.author.bot
                );
            }

            // Enregistrer les mentions dans les statistiques (exclure les bots et Netricsa)
            // Ne pas enregistrer si le message provient d'un webhook
            if (message.mentions.users.size > 0 && !message.webhookId) {
                message.mentions.users.forEach(async (user) => {
                    // Exclure les bots (incluant Netricsa) de l'enregistrement des mentions
                    if (!user.bot) {
                        recordMentionReceivedStats(user.id, user.username);

                        // Ajouter XP (la fonction détecte automatiquement si c'est un bot)
                        await addXP(
                            user.id,
                            user.username,
                            XP_REWARDS.mentionRecue,
                            message.channel as TextChannel,
                            user.bot
                        );
                    }
                });
            }

            // Enregistrer les réponses (replies) dans les statistiques
            // Exclure les commandes slash et les messages des bots
            // Exclure aussi les webhooks
            if (message.reference?.messageId && !message.author.bot && !message.webhookId && !message.content?.startsWith('/')) {
                try {
                    const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
                    if (referencedMessage) {
                        recordReplyReceivedStats(referencedMessage.author.id, referencedMessage.author.username);

                        // Ajouter XP (la fonction détecte automatiquement si c'est un bot)
                        await addXP(
                            referencedMessage.author.id,
                            referencedMessage.author.username,
                            XP_REWARDS.replyRecue,
                            message.channel as TextChannel,
                            referencedMessage.author.bot
                        );
                    }
                } catch (error) {
                    // Ignorer les erreurs de fetch (message supprimé, etc.)
                }
            }

            // Après avoir enregistré les stats, ignorer les messages des bots pour éviter les boucles
            if (message.author?.bot) return;

            // Ignorer les commandes slash-like tapées en texte
            if (message.content?.startsWith("/")) return;

            // Ignorer complètement les messages commençant par "!s"
            if (message.content?.trim().startsWith("!s")) {
                logger.info(`Message from ${message.author.username} starts with "!s" - completely ignored`);
                return;
            }

            // ===== GESTION DES DMs =====
            if (message.channel.type === ChannelType.DM) {
                logger.info(`[DM] Message from ${message.author.username}: "${message.content.substring(0, 50)}..."`);

                // Vérifier si l'utilisateur est membre du serveur
                const isMember = await isUserInRequiredServerFromDM(client, message.author);

                if (!isMember) {
                    logger.info(`[DM] User ${message.author.username} (${message.author.id}) is not a member of the server - blocking AI conversation`);

                    const errorEmbed = await createDMNotMemberErrorEmbed(client);
                    await message.reply({embeds: [errorEmbed]});
                    return;
                }

                // Fetch le canal complet si c'est un partial
                let dmChannel = message.channel;
                if (dmChannel.partial) {
                    dmChannel = await dmChannel.fetch();
                }

                // Vérifier et gérer les modes Standby/Low Power
                if (await handleBotModes(message, client, watchedChannelId)) {
                    return; // Mode actif, arrêter le traitement
                }

                let userText = message.content?.trim();
                if (!userText || userText.length === 0) {
                    logger.info(`[DM] Empty message from ${message.author.username}, ignoring`);
                    return;
                }


                const userId = message.author.id;
                const userName = message.author.username;

                // Collecter les médias (images, GIFs)
                const imageUrls = await collectAllMediaUrls(message);

                // Récupérer l'historique de conversation DM
                const dmMemory = await getDMRecentTurns(userId, 20);

                logger.info(`[DM] Processing message from ${userName} (${dmMemory.length} turns in memory)`);

                // Traiter avec processLLMRequest
                // Note: Le system prompt indique déjà que c'est une conversation privée DM
                await processLLMRequest({
                    prompt: userText, // Pas de préfixe - le system prompt gère le contexte DM
                    userId: userId,
                    userName: userName,
                    channel: dmChannel as DMChannel,
                    client: client,
                    replyToMessage: message,
                    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                    sendMessage: true,
                    skipMemory: true, // On gère la mémoire DM nous-mêmes
                    returnResponse: true
                }).then(async (response) => {
                    // Enregistrer dans la mémoire DM
                    if (response) {
                        await appendDMTurn(userId, {
                            ts: Date.now(),
                            discordUid: userId,
                            displayName: userName,
                            channelId: message.channelId,
                            channelName: "DM",
                            userText: userText,
                            assistantText: response,
                            ...(imageUrls.length > 0 ? {imageDescriptions: [`${imageUrls.length} image(s)`]} : {})
                        });
                        logger.info(`[DM] Saved conversation turn for ${userName}`);
                    }
                });

                return; // Sortir après traitement DM
            }
            // ===== FIN GESTION DES DMs =====

            // Ignorer les pings globaux (@here/@everyone) pour éviter toute réponse/scan de Netricsa
            if (message.mentions.everyone) {
                logger.info(`Message from ${message.author.username} contains @here/@everyone - ignored`);
                return;
            }

            // Vérifier et gérer les modes Standby/Low Power pour les canaux serveur
            if (await handleBotModes(message, client, watchedChannelId)) {
                return; // Mode actif, arrêter le traitement
            }


            let userText = message.content?.trim();
            const isMentioned = message.mentions.has(client.user!.id);
            const isInWatchedChannel = isWatchedChannel(message, watchedChannelId);
            const channelName = (message.channel as any).name || `channel-${message.channelId}`;

            // Gestion des mentions de Nettie (réaction uniquement)
            const contentLower = message.content?.toLowerCase() || "";
            const mentionsNettie = contentLower.includes("nettie") || contentLower.includes("netricsa");
            if (mentionsNettie && !isMentioned && !isInWatchedChannel) {

                // Ajouter une réaction emoji
                const reactionEmoji = await handleNettieReaction(client, message);

                // Logger la réaction
                await logBotReaction(
                    message.author.username,
                    channelName,
                    message.content,
                    reactionEmoji,
                    false,
                    message.author.displayAvatarURL()
                );

                return; // Ne pas répondre avec du texte, juste la réaction
            }

            // Netricsa ne répond que si mentionnée ou dans le canal surveillé
            if (!isMentioned && !isInWatchedChannel) {
                return; // Ignorer les messages où elle n'est pas mentionnée
            }

            // À partir d'ici, le bot VA RÉPONDRE (mention ou canal surveillé)

            // Collecter tous les médias (images, GIFs uploadés, GIFs Tenor)
            const imageUrls = await collectAllMediaUrls(message);

            if (!userText && imageUrls.length === 0) return;


            let contextPrompt = userText || "[Image envoyée sans texte]";
            let referencedMsg: Message | undefined = undefined;
            let mustReact = false;
            let threadStarterContext: { content: string; author: string; imageUrls: string[] } | undefined = undefined;

            // Capturer le contexte du thread starter si on est dans un thread
            // IMPORTANT: Ceci se fait TOUJOURS dans un thread, indépendamment des replies
            if (message.channel.isThread()) {
                const starterMessage = await getThreadStarterMessage(message.channel);
                if (starterMessage) {
                    const starterImageUrls = await collectAllMediaUrls(starterMessage);
                    threadStarterContext = {
                        content: starterMessage.content || "[Message sans texte]",
                        author: starterMessage.author.displayName,
                        imageUrls: starterImageUrls
                    };
                    logger.info(`Thread starter context captured from ${starterMessage.author.displayName}`);
                }
            }

            // Traiter le message référencé (si reply manuel)
            const messageReferenceId = message.reference?.messageId;
            if (messageReferenceId) {
                const refContext = await extractReferencedMessageContext(message, messageReferenceId, forumChannelId);
                if (refContext) {
                    contextPrompt = refContext.contextPrompt + contextPrompt;
                    imageUrls.push(...refContext.imageUrls);
                    referencedMsg = refContext.referencedMessage;
                    mustReact = refContext.mustReact;

                    if (refContext.imageUrls.length > 0) {
                        logger.info(`Added ${refContext.imageUrls.length} image(s) from referenced message to analysis`);
                    }
                }
            }

            // Ajouter le contexte des utilisateurs mentionnés (avec leurs UIDs)
            const mentionContext = extractMentionContext(message, client);
            if (mentionContext) {
                contextPrompt = mentionContext + contextPrompt;
            }

            // Mettre à jour les rôles Discord si l'utilisateur en a

            const triggerReason = isMentioned ? "mentioned" : "watched channel";
            logger.info(`Processing message from ${message.author.displayName} (${triggerReason}): ${userText}${imageUrls.length > 0 ? ` [${imageUrls.length} image(s)]` : ""}`);

            // Mettre à jour l'activité de l'utilisateur (jeu en cours)
            await updateUserActivityFromPresence(client, message.author.id);

            // Mettre à jour les rôles Discord de l'utilisateur dans son profil
            if (message.member) {
                const userRoles = message.member.roles.cache
                    .filter(role => role.name !== "@everyone") // Exclure le rôle @everyone
                    .map(role => role.name);

                if (userRoles.length > 0) {
                    const {UserProfileService} = await import("./services/userProfileService");
                    await UserProfileService.updateRoles(message.author.id, message.author.displayName, userRoles);
                }
            }

            await processLLMRequest({
                prompt: contextPrompt,
                userId: message.author.id,
                userName: message.author.displayName,
                channel: message.channel as TextChannel,
                client: client,
                replyToMessage: message,
                referencedMessage: referencedMsg,
                imageUrls,
                threadStarterContext,
                originalUserMessage: userText || "[Image envoyée sans texte]", // Message original pour la mémoire
            });

            // Enregistrer la conversation IA dans les statistiques
            recordAIConversationStats(message.author.id, message.author.displayName);

            // Tracker la conversation IA pour l'imposteur
            const {trackImpostorAIConversation} = require("./services/events/impostorMissionTracker");
            await trackImpostorAIConversation(message.client, message.author.id);

            // Vérifier les achievements Netricsa
            const {checkNetricsaAchievements} = require("./services/netricsaAchievementChecker");
            await checkNetricsaAchievements(
                message.author.id,
                message.author.username,
                message.client,
                message.channelId
            );

            await setBotPresence(client, "online");
        } catch (err) {
            logger.error("messageCreate error:", err);
            try {
                await message.reply({content: "An error occurred while processing your message."});
            } catch (replyErr) {
                logger.error("Failed to send error message:", replyErr);
            }
        }
    });
}
