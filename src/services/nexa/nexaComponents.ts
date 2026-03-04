/**
 * Nexa - Components V2 du panneau jukebox
 */

import * as path from "path";
import {ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder,} from "discord.js";
import type {Player, Track} from "lavalink-client";

const PLACEHOLDER_FILENAME = "nexa_placeholder.png";
const PLACEHOLDER_PATH = path.join(process.cwd(), "assets", PLACEHOLDER_FILENAME);
const PLACEHOLDER_URL = `attachment://${PLACEHOLDER_FILENAME}`;

function makePlaceholderAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(PLACEHOLDER_PATH, {name: PLACEHOLDER_FILENAME});
}

function fmt(ms: number): string {
    if (!ms) return "0:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function trackToDisplay(t: Track) {
    return {
        title: t.info.title,
        url: t.info.uri ?? "",
        duration: t.info.isStream ? "LIVE" : fmt(t.info.duration ?? 0),
        thumbnail: t.info.artworkUrl ?? "",
        channel: t.info.author ?? "",
        isLive: t.info.isStream ?? false,
        requestedBy: (t as any).requester?.username ?? (t as any).requester?.name ?? "",
        requestedById: (t as any).requester?.id ?? "",
    };
}

/** Construit le message Components V2 du panneau jukebox */
export function buildJukeboxPanel(player: Player | null): { components: any[]; flags: number; files?: AttachmentBuilder[] } {
    const container = new ContainerBuilder();

    const current = player?.queue?.current as Track | null | undefined;
    const isPaused = player?.paused ?? false;
    const isPlaying = !!current;
    const repeatMode = player?.repeatMode ?? "off";
    const volume = player?.volume ?? 80;
    const queue = (player?.queue?.tracks ?? []) as Track[];

    // ── Grande image (thumbnail ou placeholder pour garder une taille constante)
    if (current) {
        const info = trackToDisplay(current);
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## 🎵 Nexa — En écoute\n**[${info.title}](${info.url})**\n-# 📺 ${info.channel}${info.isLive ? " · 🔴 LIVE" : ` · ⏱️ ${info.duration}`}${info.requestedBy ? ` · demandé par **${info.requestedBy}**` : ""}`
            )
        );
        const thumbUrl = info.thumbnail || PLACEHOLDER_URL;
        const files = info.thumbnail ? undefined : [makePlaceholderAttachment()];
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(thumbUrl)
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder());

        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId("nexa_playpause")
                    .setLabel(isPaused ? "▶️ Reprendre" : "⏸ Pause")
                    .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setDisabled(!isPlaying),
                new ButtonBuilder()
                    .setCustomId("nexa_skip")
                    .setLabel("⏭ Skip")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!isPlaying),
                new ButtonBuilder()
                    .setCustomId("nexa_stop")
                    .setLabel("⏹ Stop")
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(!isPlaying),
                new ButtonBuilder()
                    .setCustomId("nexa_loop")
                    .setLabel(repeatMode === "off" ? "🔁 Loop : Off" : repeatMode === "track" ? "🔂 Loop : Titre" : "🔁 Loop : File")
                    .setStyle(repeatMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("nexa_shuffle")
                    .setLabel("🔀 Shuffle")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(queue.length < 2),
            )
        );
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId("nexa_vol_down")
                    .setLabel("🔉 -10%")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!isPlaying),
                new ButtonBuilder()
                    .setCustomId("nexa_vol_up")
                    .setLabel("🔊 +10%")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!isPlaying),
                new ButtonBuilder()
                    .setCustomId("nexa_vol_info")
                    .setLabel(`Volume : ${volume}%`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
            )
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        if (queue.length > 0) {
            const lines = queue.slice(0, 5).map((t, i) => {
                const inf = trackToDisplay(t);
                return `**${i + 1}.** ${inf.title} · *${inf.duration}*`;
            });
            const extra = queue.length > 5 ? `\n-# *… et ${queue.length - 5} autre(s)*` : "";
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**📋 File d'attente :**\n${lines.join("\n")}${extra}`)
            );
        } else {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent("-# *File vide après ce titre.*")
            );
        }

        return {components: [container], flags: MessageFlags.IsComponentsV2, ...(files ? {files} : {})};
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "## 🎵 Nexa — Jukebox\n*Aucune musique en cours.*\n-# Envoie le titre d'une chanson dans ce salon pour lancer la lecture !"
            )
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(PLACEHOLDER_URL)
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder());

        const repeatModeIdle = player?.repeatMode ?? "off";
        const volumeIdle = player?.volume ?? 80;

        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("nexa_playpause").setLabel("⏸ Pause").setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_skip").setLabel("⏭ Skip").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_stop").setLabel("⏹ Stop").setStyle(ButtonStyle.Danger).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_loop").setLabel("🔁 Loop : Off").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("nexa_shuffle").setLabel("🔀 Shuffle").setStyle(ButtonStyle.Secondary).setDisabled(true),
            )
        );
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("nexa_vol_down").setLabel("🔉 -10%").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_vol_up").setLabel("🔊 +10%").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_vol_info").setLabel(`Volume : ${volumeIdle}%`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            )
        );

        return {components: [container], flags: MessageFlags.IsComponentsV2, files: [makePlaceholderAttachment()]};
    }
}

/** Message de confirmation d'ajout de track (avec sélection parmi plusieurs résultats) */
export function buildTrackProposal(tracks: Track[], userId: string): { components: any[]; flags: number; files?: AttachmentBuilder[] } {
    const track = tracks[0];
    const info = trackToDisplay(track);
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 🎵 Résultat trouvé\n**[${info.title}](${info.url})**\n-# 📺 ${info.channel}${info.isLive ? " · 🔴 LIVE" : ` · ⏱️ ${info.duration}`}`
        )
    );
    const thumbUrl = info.thumbnail || PLACEHOLDER_URL;
    const files = info.thumbnail ? undefined : [makePlaceholderAttachment()];
    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(thumbUrl)
        )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`nexa_confirm_${userId}`).setLabel("▶️ Ajouter à la file").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`nexa_cancel_${userId}`).setLabel("✖ Annuler").setStyle(ButtonStyle.Secondary),
        )
    );

    // Select menu pour les autres résultats (si disponibles)
    const alternatives = tracks.slice(1, 6);
    if (alternatives.length > 0) {
        const options = alternatives.map((t, i) => {
            const alt = trackToDisplay(t);
            const label = alt.title.slice(0, 100);
            const desc = `${alt.channel} · ${alt.duration}`.slice(0, 100);
            return new StringSelectMenuOptionBuilder()
                .setValue(`nexa_alt_${userId}_${i + 1}`)
                .setLabel(label)
                .setDescription(desc);
        });
        container.addActionRowComponents(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`nexa_select_${userId}`)
                    .setPlaceholder("🎵 Choisir un autre résultat...")
                    .addOptions(options)
            )
        );
    }

    return {components: [container], flags: MessageFlags.IsComponentsV2, ...(files ? {files} : {})};
}
