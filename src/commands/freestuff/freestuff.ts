import {AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder} from "discord.js";
import {getCurrentFreeGames} from "../../services/freeGamesService";
import {handleInteractionError} from "../../utils/interactionUtils";

module.exports = {
    data: new SlashCommandBuilder()
        .setName("freestuff")
        .setDescription("🎮 Affiche les offres gratuites disponibles en ce moment")
        .addStringOption(option =>
            option
                .setName("categorie")
                .setDescription("Type de contenu à afficher")
                .setRequired(false)
                .addChoices(
                    {name: "🎮 Jeux", value: "games"},
                    {name: "📦 Autres produits (Assets, musiques, etc...)", value: "other"}
                )
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        try {
            await interaction.deferReply();

            const category = (interaction.options.getString("categorie") ?? undefined) as "games" | "other" | undefined;
            const games = getCurrentFreeGames(category);

            if (games.length === 0) {
                const categoryLabel = category === "games"
                    ? "jeu gratuit"
                    : category === "other"
                        ? "autre produit gratuit"
                        : "offre gratuite";

                const embed = new EmbedBuilder()
                    .setColor(0xfbd687)
                    .setTitle("🎁 Promotions")
                    .setDescription(`Aucun ${categoryLabel} disponible en ce moment.\n\nReviens plus tard, de nouvelles offres arrivent régulièrement !`)
                    .setTimestamp();

                await interaction.editReply({embeds: [embed]});
                return;
            }

            // Tous les containers dans un seul message
            const allContainers = games.map(g => g.container);
            const allFiles = games
                .map(g => g.logoAttachment)
                .filter(f => f !== null) as AttachmentBuilder[];

            const message: any = {
                components: allContainers,
                flags: MessageFlags.IsComponentsV2
            };
            if (allFiles.length > 0) message.files = allFiles;

            await interaction.editReply(message);

        } catch (error: any) {
            await handleInteractionError(interaction, error, "FreeStuff");
        }
    },
};
