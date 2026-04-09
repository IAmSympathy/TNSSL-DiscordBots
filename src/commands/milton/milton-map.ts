import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
    StageChannel,
    VoiceChannel
} from "discord.js";
import {createMiltonMapLaunch} from "../../services/milton/minecraftMapActivityService";
import {handleInteractionError} from "../../utils/interactionUtils";

function asVoiceChannel(channel: VoiceChannel | StageChannel | null): VoiceChannel | StageChannel | null {
    if (!channel) {
        return null;
    }

    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        return channel;
    }

    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("milton-map")
        .setDescription("🗺️ Lance la carte Minecraft Milton en activite vocale")
        .addChannelOption((option) =>
            option
                .setName("salon")
                .setDescription("Salon vocal cible (sinon ton salon vocal actuel)")
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(false)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        try {
            if (!interaction.guild) {
                await interaction.reply({
                    content: "❌ Cette commande doit etre utilisee dans un serveur.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const member = await interaction.guild.members.fetch(interaction.user.id);
            const selectedChannel = interaction.options.getChannel("salon", false);

            const fromOption = asVoiceChannel((selectedChannel as VoiceChannel | StageChannel | null) || null);
            const fromMemberVoice = asVoiceChannel(member.voice.channel as VoiceChannel | StageChannel | null);
            const targetVoiceChannel = fromOption || fromMemberVoice;

            if (!targetVoiceChannel) {
                await interaction.reply({
                    content: "❌ Rejoins un salon vocal (ou precise `salon`) pour lancer Milton Map.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.deferReply({flags: MessageFlags.Ephemeral});

            const launch = await createMiltonMapLaunch(targetVoiceChannel);
            const buttons: ButtonBuilder[] = [
                new ButtonBuilder()
                    .setLabel("Ouvrir la map")
                    .setStyle(ButtonStyle.Link)
                    .setURL(launch.mapUrl)
            ];

            let description = `Carte Milton prete pour <#${targetVoiceChannel.id}>.`;
            if (launch.mode === "embedded") {
                buttons.unshift(
                    new ButtonBuilder()
                        .setLabel("Lancer l'activite")
                        .setStyle(ButtonStyle.Link)
                        .setURL(launch.inviteUrl)
                );
                description += "\n✅ Invite d'activite creee (mode voice activity).";
            } else {
                description += "\n⚠️ Activity Discord non configuree, lien web envoye en fallback.";
            }

            const embed = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle("🧭 Milton Map Viewer")
                .setDescription(description)
                .setFooter({text: "Astuce: configure MILTON_ACTIVITY_APPLICATION_ID pour un vrai lancement type Wordle/Watch Together."});

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
        } catch (error: any) {
            await handleInteractionError(interaction, error, "MiltonMap");
        }
    }
};


