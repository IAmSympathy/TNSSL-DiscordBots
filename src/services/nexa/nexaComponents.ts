/**
 * Nexa - Components V2 du panneau jukebox
 */

import * as path from "path";
import * as https from "https";
import * as http from "http";
import sharp from "sharp";
import {ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder,} from "discord.js";
import type {Player, Track} from "lavalink-client";
// SectionBuilder et ThumbnailBuilder existent à runtime mais pas encore dans les types
const {SectionBuilder, ThumbnailBuilder} = require("discord.js") as any;

const PLACEHOLDER_FILENAME = "nexa_placeholder.png";
const PLACEHOLDER_PATH = path.join(process.cwd(), "assets", PLACEHOLDER_FILENAME);
const PLACEHOLDER_URL = `attachment://${PLACEHOLDER_FILENAME}`;

function makePlaceholderAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(PLACEHOLDER_PATH, {name: PLACEHOLDER_FILENAME});
}

/** Télécharge une thumbnail distante, la redimensionne en 1920×1080 (cover) et la retourne comme AttachmentBuilder */
async function fetchThumbnailAttachment(url: string): Promise<AttachmentBuilder | null> {
    return fetchThumbnailAttachmentSized(url, 1920, 1080);
}

async function fetchThumbnailAttachmentSized(url: string, width: number, height: number): Promise<AttachmentBuilder | null> {
    try {
        const raw = await new Promise<Buffer>((resolve, reject) => {
            const proto = url.startsWith("https") ? https : http;
            proto.get(url, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c: Buffer) => chunks.push(c));
                res.on("end", () => resolve(Buffer.concat(chunks)));
                res.on("error", reject);
            }).on("error", reject);
        });
        const resized = await sharp(raw)
            .resize(width, height, {fit: "cover", position: "centre"})
            .jpeg({quality: 85})
            .toBuffer();
        return new AttachmentBuilder(resized, {name: "thumb.jpg"});
    } catch {
        return null;
    }
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
        requestedBy: (t as any).requester?.displayName ?? (t as any).requester?.name ?? "",
        requestedById: (t as any).requester?.id ?? "",
    };
}

/** Construit le message Components V2 du panneau jukebox */
export async function buildJukeboxPanel(player: Player | null, history: Track[] = []): Promise<{ components: any[]; flags: number; files?: AttachmentBuilder[] }> {
    const container = new ContainerBuilder();

    const current = player?.queue?.current as Track | null | undefined;
    const isPaused = player?.paused ?? false;
    const isPlaying = !!current;
    const repeatMode = player?.repeatMode ?? "off";
    const queue = (player?.queue?.tracks ?? []) as Track[];
    const hasHistory = history.length > 0;

    if (current) {
        const info = trackToDisplay(current);

        // Thumbnail : téléchargée comme attachment pour taille uniforme
        let thumbUrl = PLACEHOLDER_URL;
        let files: AttachmentBuilder[] = [makePlaceholderAttachment()];
        if (info.thumbnail) {
            const thumbAttachment = await fetchThumbnailAttachment(info.thumbnail);
            if (thumbAttachment) {
                thumbUrl = "attachment://thumb.jpg";
                files = [thumbAttachment];
            }
        }

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## 💽 Nexa's Jukebox — Mode Requête\n**[${info.title}](${info.url})**\n-# 📺 ${info.channel}${info.isLive ? " · 🔴 LIVE" : ` · ⏱️ ${info.duration}`}${info.requestedBy ? ` · demandé par **${info.requestedBy}**` : ""}`
            )
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(thumbUrl))
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId("nexa_prev")
                    .setLabel("⏮ Préc.")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasHistory),
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
                    .setLabel(repeatMode === "off" ? "🔁 Boucle: Off" : repeatMode === "track" ? "🔂 Boucle: Titre" : "🔁 Boucle: File")
                    .setStyle(repeatMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
            )
        );
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId("nexa_shuffle")
                    .setLabel("🔀 Shuffle")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(queue.length < 2),
            )
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        // File : précédents + courant + suivants dans un codeblock
        {
            const MAX_PREV = 2;
            const MAX_NEXT = 4;

            const shownPrev = history.slice(-MAX_PREV);
            const shownNext = queue.slice(0, MAX_NEXT);

            const lines: string[] = [];

            for (const t of shownPrev) {
                const inf = trackToDisplay(t);
                const title = inf.title.length > 46 ? inf.title.slice(0, 45) + "…" : inf.title;
                lines.push(`  ${title} (${inf.duration})`);
            }

            const currentTitle = info.title.length > 44 ? info.title.slice(0, 43) + "…" : info.title;
            lines.push(`‎ ‎ ‎ ▶ ${currentTitle} (${info.duration})`);

            for (const t of shownNext) {
                const inf = trackToDisplay(t);
                const title = inf.title.length > 46 ? inf.title.slice(0, 45) + "…" : inf.title;
                lines.push(`  ${title} (${inf.duration})`);
            }

            const totalHidden = (history.length - shownPrev.length) + (queue.length - shownNext.length);
            const total = history.length + 1 + queue.length;

            // Durée totale restante (track courante + suivantes)
            const remainingMs = (current?.info.isStream ? 0 : (current?.info.duration ?? 0))
                + queue.reduce((acc, t) => acc + (t.info.isStream ? 0 : (t.info.duration ?? 0)), 0);
            const remainingFmt = info.isLive ? "∞" : fmt(remainingMs);

            const footer = totalHidden > 0
                ? `\n-# *+ ${totalHidden} autre${totalHidden > 1 ? "s" : ""} cachés — ${total} titres au total*`
                : `\n-# *${total} titre${total > 1 ? "s" : ""} au total*`;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**📋 Liste de lecture:** ‎‎‎‎‎ **${remainingFmt}** restant \n\`\`\`\n${lines.join("\n")}\n\`\`\`${footer}`)
            );
        }

        return {components: [container], flags: MessageFlags.IsComponentsV2, files};
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "## 💽 Nexa's Jukebox\n*Aucune musique en cours.*\n-# Envoie le titre d'une chanson dans ce salon pour lancer la lecture !"
            )
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(PLACEHOLDER_URL))
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("nexa_prev").setLabel("⏮ Préc.").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_playpause").setLabel("⏸ Pause").setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_skip").setLabel("⏭ Skip").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_stop").setLabel("⏹ Stop").setStyle(ButtonStyle.Danger).setDisabled(true),
                new ButtonBuilder().setCustomId("nexa_loop").setLabel("🔁 Off").setStyle(ButtonStyle.Secondary).setDisabled(true),
            )
        );
        return {components: [container], flags: MessageFlags.IsComponentsV2, files: [makePlaceholderAttachment()]};
    }
}

/** Message de confirmation d'ajout de track (avec sélection parmi plusieurs résultats) */
export async function buildTrackProposal(tracks: Track[], userId: string): Promise<{ components: any[]; flags: number }> {
    const track = tracks[0];
    const info = trackToDisplay(track);
    const container = new ContainerBuilder();

    // Section avec thumbnail native (petite, à droite) — pas besoin d'uploader un fichier
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### 🎵 Résultat trouvé\n**[${info.title}](${info.url})**\n-# 📺 ${info.channel}${info.isLive ? " · 🔴 LIVE" : ` · ⏱️ ${info.duration}`}`
            )
        );
    if (info.thumbnail) {
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(info.thumbnail));
    }
    container.addSectionComponents(section);

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

    return {components: [container], flags: MessageFlags.IsComponentsV2};
}
