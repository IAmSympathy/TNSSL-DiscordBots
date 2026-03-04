import {ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder} from "discord.js";
import {forceConnectivityCheck, getStandbyStats, isStandbyMode} from "../../services/standbyModeService";
import {logCommand} from "../../utils/discordLogger";
import {handleInteractionError, safeReply} from "../../utils/interactionUtils";
import {getChannelNameFromInteraction} from "../../utils/channelHelper";

module.exports = {
    data: new SlashCommandBuilder()
        .setName("standby-status")
        .setDescription("💤 Affiche le statut du mode veille et force une vérification de connectivité"),

    async execute(interaction: ChatInputCommandInteraction) {
        try {
            await interaction.deferReply({flags: MessageFlags.Ephemeral});

            const stats = getStandbyStats();
            const isStandby = isStandbyMode(interaction.client);

            // Forcer une vérification immédiate
            const status = await forceConnectivityCheck(interaction.client);

            const embed = new EmbedBuilder()
                .setColor(isStandby ? 0xffa500 : 0x00ff00)
                .setTitle(isStandby ? "💤 Mode Veille ACTIF" : "✅ Mode Normal")
                .setDescription(
                    isStandby
                        ? "Le bot est en mode veille car les services locaux sont inaccessibles."
                        : "Le bot fonctionne normalement. Tous les services sont accessibles."
                )
                .addFields(
                    {
                        name: "📊 État des services",
                        value: `**Ollama:** ${status.ollama ? '✅ Accessible' : '❌ Inaccessible'}\n**API Python:** ${status.pythonAPI ? '✅ Accessible' : '❌ Inaccessible'}`,
                        inline: false
                    },
                    {
                        name: "🔍 Dernière vérification",
                        value: stats.lastCheck ? `<t:${Math.floor(stats.lastCheck.getTime() / 1000)}:R>` : "Jamais",
                        inline: true
                    },
                    {
                        name: "❌ Vérifications échouées",
                        value: stats.failedChecks.toString(),
                        inline: true
                    },
                    {
                        name: "⏱️ Intervalle de vérification",
                        value: `${stats.checkInterval / 1000} secondes`,
                        inline: true
                    }
                )
                .setTimestamp();

            if (isStandby) {
                embed.setFooter({
                    text: "Le bot vérifie automatiquement la connectivité et reviendra en mode normal dès que possible"
                });
            }

            await safeReply(interaction, {embeds: [embed]}, true);

            // Logger la commande
            const channelName = getChannelNameFromInteraction(interaction);
            await logCommand("💤 Vérification du mode veille", undefined, [
                {name: "👤 Par", value: interaction.user.username, inline: true},
                {name: "📊 État", value: isStandby ? "Veille" : "Normal", inline: true},
                {name: "🔍 Ollama", value: status.ollama ? "✅" : "❌", inline: true},
                {name: "🎨 Python API", value: status.pythonAPI ? "✅" : "❌", inline: true}
            ], undefined, channelName, interaction.user.displayAvatarURL());

        } catch (error: any) {
            await handleInteractionError(interaction, error, "StandbyStatus");
        }
    },
};

