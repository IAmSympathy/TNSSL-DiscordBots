import {ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder} from "discord.js";
import {generateImage} from "../../services/imageGenerationService";
import {logBotImageGeneration} from "../../utils/discordLogger";
import {createErrorEmbed, createLowPowerEmbed, createStandbyEmbed} from "../../utils/embedBuilder";
import {createLogger} from "../../utils/logger";
import {registerImageGeneration, unregisterImageGeneration, updateJobId} from "../../services/imageGenerationTracker";
import {formatTime} from "../../utils/timeFormat";
import {BotStatus, clearStatus, setStatus} from "../../services/statusService";
import {TYPING_ANIMATION_INTERVAL} from "../../utils/constants";
import {isLowPowerMode} from "../../services/botStateService";
import {NETRICSA_USER_ID, NETRICSA_USERNAME} from "../../services/userStatsService";
import {recordImageGeneratedStats} from "../../services/statsRecorder";
import {tryRewardAndNotify} from "../../services/rewardNotifier";
import {addUserToQueue, getUserQueueOperation, isOperationAborted, isUserInQueue, registerActiveOperation, removeUserFromQueue, unregisterActiveOperation} from "../../queue/globalQueue";
import {getChannelNameFromInteraction} from "../../utils/channelHelper";

const logger = createLogger("GenerateImageCmd");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("imagine")
        .setDescription("🎨 Demande à Netricsa de générer une image")
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("Description de l'image à générer (EN ANGLAIS)")
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("negative")
                .setDescription("Ce que tu NE veux PAS dans l'image (optionnel, EN ANGLAIS)")
                .setRequired(false)
        )
        .addIntegerOption((option) =>
            option
                .setName("amount")
                .setDescription("Nombre d'images à générer")
                .setRequired(false)
                .addChoices(
                    {name: "1", value: 1},
                    {name: "2", value: 2},
                    {name: "3", value: 3}
                )
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        // Vérifier que l'utilisateur est membre du serveur requis
        const {checkServerMembershipOrReply} = require("../../utils/serverMembershipCheck");
        if (!await checkServerMembershipOrReply(interaction)) {
            return;
        }

        // Obtenir le nom du canal pour le logging
        const channelName = getChannelNameFromInteraction(interaction);

        // Vérifier si l'utilisateur est déjà dans la queue globale
        if (isUserInQueue(interaction.user.id)) {
            const operation = getUserQueueOperation(interaction.user.id);
            const errorEmbed = createErrorEmbed(
                "⏳ Opération en Cours",
                `Tu as déjà une opération en cours (${operation}). Attends qu'elle soit terminée avant d'en lancer une nouvelle, ou utilise \`/stop\` pour l'annuler.`
            );
            await interaction.reply({embeds: [errorEmbed], flags: MessageFlags.Ephemeral});
            return;
        }

        // Vérifier le mode low power
        if (isLowPowerMode()) {
            const errorEmbed = createLowPowerEmbed(
                "Mode Économie d'Énergie",
                "Netricsa est en mode économie d'énergie, car l'ordinateur de son créateur priorise les performances pour d'autres tâches. La génération d'images n'est pas disponible pour le moment."
            );
            await interaction.reply({embeds: [errorEmbed], flags: MessageFlags.Ephemeral});
            return;
        }

        // Vérifier le mode standby
        const {isStandbyMode} = require('../../services/standbyModeService');
        if (isStandbyMode(interaction.client)) {
            const errorEmbed = createStandbyEmbed(
                "Mode Veille",
                "Netricsa est en mode veille, car elle ne peut se connecter à l'ordinateur de son créateur. La génération d'images n'est pas disponible pour le moment."
            );
            await interaction.reply({embeds: [errorEmbed], flags: MessageFlags.Ephemeral});
            return;
        }

        let progressMessage: any = null;
        let statusId: string = "";

        try {
            const prompt = interaction.options.getString("prompt", true);
            const negativePrompt = interaction.options.getString("negative");
            const amount = interaction.options.getInteger("amount") || 1;

            const width = 1024;
            const height = 1024;
            const steps = 22;
            const cfgScale = 7.5;

            logger.info(`Generating image for ${interaction.user.username}: "${prompt.substring(0, 50)}..."`);

            // Définir le statut Discord et stocker l'ID (10 minutes pour les générations longues)
            statusId = await setStatus(interaction.client, BotStatus.GENERATING_IMAGE, 600000);

            // Message de progression avec animation de points
            progressMessage = await interaction.reply({
                content: `\`Imagination de ${amount === 1 ? "l'" : `${amount} `}${amount === 1 ? "image" : "images"}.\``
            });

            // Animation des points
            let dotCount = 1;
            const animationInterval = setInterval(async () => {
                dotCount = (dotCount % 3) + 1;
                const dots = ".".repeat(dotCount);

                const label = amount === 1 ? "image" : "images";

                await progressMessage
                    .edit(`\`Imagination de ${amount === 1 ? "l’" : `${amount} `}${label}${dots}\n\``)
                    .catch(() => {
                    });
            }, TYPING_ANIMATION_INTERVAL);

            // Ajouter l'utilisateur à la queue globale
            addUserToQueue(interaction.user.id, 'imagine');

            // Créer un ID unique pour cette opération
            const operationId = `imagine-${interaction.user.id}-${Date.now()}`;
            registerActiveOperation(operationId, 'imagine', interaction.user.id, interaction.channelId);

            // Enregistrer la génération dans le tracker (pour l'annulation spécifique)
            registerImageGeneration(
                interaction.user.id,
                interaction.channelId,
                "imagine",
                animationInterval
            );

            // Générer les images
            const startTime = Date.now();
            const results = [];

            for (let i = 0; i < amount; i++) {
                // Vérifier si l'opération a été annulée
                if (isOperationAborted(operationId)) {
                    logger.info(`Image generation cancelled by user for ${interaction.user.id}`);
                    clearInterval(animationInterval);
                    unregisterImageGeneration(interaction.user.id);
                    unregisterActiveOperation(operationId);
                    removeUserFromQueue(interaction.user.id);

                    await progressMessage.edit("🛑 Génération annulée.");
                    await clearStatus(interaction.client, statusId);
                    return;
                }

                const result = await generateImage({
                    prompt,
                    negativePrompt: negativePrompt || undefined,
                    width,
                    height,
                    steps,
                    cfgScale,
                    seed: -1, // Seed aléatoire pour chaque image
                });

                // Mettre à jour le job_id dans le tracker pour permettre l'annulation
                if (result.jobId) {
                    updateJobId(interaction.user.id, result.jobId);
                }

                results.push(result);
            }

            const generationTime = ((Date.now() - startTime) / 1000).toFixed(1);

            // Arrêter l'animation
            clearInterval(animationInterval);

            // Désenregistrer la génération du tracker et de la queue globale
            unregisterImageGeneration(interaction.user.id);
            unregisterActiveOperation(operationId);
            removeUserFromQueue(interaction.user.id);

            // Construire le Container Components v2
            const {ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags: MF} = require("discord.js");

            let textContent = `### 🎨 ${amount > 1 ? `${amount} images générées` : "Image générée"}\n`;
            textContent += `📝 Prompt : \`${prompt.length > 900 ? prompt.substring(0, 897) + "..." : prompt}\``;
            if (negativePrompt) {
                textContent += `\n🚫 Négatif : \`${negativePrompt.length > 900 ? negativePrompt.substring(0, 897) + "..." : negativePrompt}\``;
            }

            const gallery = new MediaGalleryBuilder();
            for (const r of results) {
                gallery.addItems(new MediaGalleryItemBuilder().setURL(`attachment://${r.attachment.name}`));
            }

            const container = new ContainerBuilder()
                .setAccentColor(0xd99e82)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(textContent))
                .addMediaGalleryComponents(gallery)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ⏱️ Temps de génération : ${generationTime}s`));

            const sendPayload: any = {
                content: "",
                components: [container],
                flags: MF.IsComponentsV2,
                files: results.map(r => r.attachment)
            };

            try {
                const finalMessage = await progressMessage.edit(sendPayload);
                const imageUrls = Array.from(finalMessage.attachments.values()).map((att: any) => att.url);
                await logBotImageGeneration(
                    interaction.user.username,
                    prompt,
                    formatTime(parseFloat(generationTime)),
                    imageUrls,
                    channelName,
                    interaction.user.displayAvatarURL()
                );
            } catch (editError: any) {
                logger.warn(`Cannot edit message, sending as follow-up. Error: ${editError.code}`);
                const followUpMessage = await interaction.followUp(sendPayload);
                const imageUrls = Array.from(followUpMessage.attachments.values()).map((att: any) => att.url);
                await logBotImageGeneration(
                    interaction.user.username,
                    prompt,
                    formatTime(parseFloat(generationTime)),
                    imageUrls,
                    channelName,
                    interaction.user.displayAvatarURL()
                );
            }

            // Enregistrer dans les statistiques utilisateur (UNE SEULE fois par commande, peu importe le nombre de variantes)
            recordImageGeneratedStats(interaction.user.id, interaction.user.username);
            // Enregistrer aussi pour Netricsa elle-même (une seule fois)
            recordImageGeneratedStats(NETRICSA_USER_ID, NETRICSA_USERNAME);

            // Tracker la génération d'image pour l'imposteur
            const {trackImpostorImageGeneration} = require("../../services/events/impostorMissionTracker");
            await trackImpostorImageGeneration(interaction.client, interaction.user.id);

            // Vérifier les achievements Netricsa
            const {checkNetricsaAchievements} = require("../../services/netricsaAchievementChecker");
            await checkNetricsaAchievements(
                interaction.user.id,
                interaction.user.username,
                interaction.client,
                interaction.channelId
            );

            // Ajouter XP avec notification de level up (UNE SEULE fois par commande)
            const {addXP, XP_REWARDS} = require("../../services/xpSystem");
            if (interaction.channel) {
                await addXP(
                    interaction.user.id,
                    interaction.user.username,
                    XP_REWARDS.imageGeneree,
                    interaction.channel,
                    false
                );
            }

            // Chance d'obtenir un objet saisonnier (3% - commande Netricsa)
            const {tryRewardAndNotify} = require("../../services/rewardNotifier");
            await tryRewardAndNotify(interaction, interaction.user.id, interaction.user.username, "netricsa_command");

            logger.info("✅ Image generation completed successfully");

            // Réinitialiser le statut spécifique de cette génération
            await clearStatus(interaction.client, statusId);

        } catch (error) {
            logger.error("Error generating image:", error);

            // Désenregistrer la génération en cas d'erreur
            unregisterImageGeneration(interaction.user.id);
            removeUserFromQueue(interaction.user.id);

            // Réinitialiser le statut spécifique de cette génération
            await clearStatus(interaction.client, statusId);

            // Si c'est une annulation, éditer le message pour indiquer l'annulation
            if (error instanceof Error && error.message === "CANCELLED") {
                logger.info("Generation cancelled by user");
                if (progressMessage) {
                    try {
                        await progressMessage.edit("🛑 Génération annulée.");
                    } catch (editError) {
                        await interaction.followUp({content: "🛑 Génération annulée.", ephemeral: true});
                    }
                }
                return;
            }

            const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";

            let errorTitle = "Erreur de Génération";
            let errorDescription = `Impossible de générer l'image.\n\n**Erreur:** ${errorMessage}`;

            // Personnaliser le message selon le type d'erreur
            if (errorMessage.includes("CONNECTION_ERROR")) {
                errorTitle = "Service Indisponible";
                errorDescription = "❌ **L'API de génération d'images n'est pas accessible.**\n\n" +
                    "Le serveur est peut-être hors ligne, en maintenance, ou surchargé.\n\n" +
                    "📌 **Que faire ?**\n" +
                    "• Réessayer dans quelques instants\n" +
                    "• Vérifier si Netricsa est en mode veille (💤)\n" +
                    "• Contacter un administrateur si le problème persiste";
            } else if (errorMessage.includes("STANDBY_MODE")) {
                errorTitle = "Mode Veille";
                errorDescription = "💤 **Netricsa est en mode veille.**\n\n" +
                    "L'API de génération d'images n'est pas accessible pour le moment.\n\n" +
                    "Le bot vérifie régulièrement la disponibilité des services et reviendra en mode normal automatiquement.";
            }

            const errorEmbed = createErrorEmbed(errorTitle, errorDescription);

            // Si l'interaction a déjà été répondue, utiliser editReply, sinon reply
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({embeds: [errorEmbed]});
            } else {
                await interaction.reply({embeds: [errorEmbed], ephemeral: true});
            }
        }
    },
};
