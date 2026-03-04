/**
 * Nexa - Components V2 du panneau jukebox
 */

import * as path from "path";
import * as https from "https";
import * as http from "http";
import sharp from "sharp";
import {ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder,} from "discord.js";
import type {Player, Track} from "lavalink-client";
import {FILTERS, getActiveFilters} from "./nexaFilters";
import {getClosingTimer, getSavedFilter} from "./nexaBot";
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

const BAR_WIDTH = 40; // ~largeur d'un MediaGallery Discord en monospace

/** Cache URL CDN Discord par URL source — évite de re-uploader la même thumbnail */
const thumbnailCdnCache = new Map<string, string>();

export function cacheThumbnailCdn(sourceUrl: string, cdnUrl: string): void {
    thumbnailCdnCache.set(sourceUrl, cdnUrl);
}

function buildProgressBar(posMs: number, durationMs: number): string {
    if (!durationMs) return "";
    const ratio = Math.min(1, Math.max(0, posMs / durationMs));
    const filled = Math.round(ratio * BAR_WIDTH);
    const bar = "▰".repeat(filled) + "▱".repeat(BAR_WIDTH - filled);
    const elapsed = fmt(posMs);
    const remaining = fmt(Math.max(0, durationMs - posMs));
    // elapsed à gauche, remaining à droite, séparés par la barre
    return `-# ${elapsed} ${bar} -${remaining}`;
}

export function trackToDisplay(t: Track) {
    const sourceName: string = (t.info as any).sourceName ?? "";
    const sourceEmoji: Record<string, string> = {
        youtube: "<:Nexa_Youtube:1478660975736651857>",
        youtubemusic: "<:Nexa_YoutubeMusic:1478660976864923678>",
        soundcloud: "<:Nexa_SoundCloud:1478660979754537030>",
        spotify: "<:Nexa_Spotify:1478660977875615814>",
        applemusic: "<:Nexa_AppleMusic:1478660980530483320>",
        deezer: "<:Nexa_Deezer:1478660978936909898>",
        twitch: "<:Nexa_Twitch:1478660981398700052>",
    };
    return {
        title: t.info.title,
        url: t.info.uri ?? "",
        duration: t.info.isStream ? "LIVE" : fmt(t.info.duration ?? 0),
        thumbnail: t.info.artworkUrl ?? "",
        channel: t.info.author ?? "",
        isLive: t.info.isStream ?? false,
        requestedBy: (t as any).requester?.displayName ?? (t as any).requester?.name ?? "",
        requestedById: (t as any).requester?.id ?? "",
        sourceName,
        sourceEmoji: sourceEmoji[sourceName.toLowerCase()] ?? "🎵",
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

        // Thumbnail : utiliser le cache CDN si disponible, sinon uploader
        let thumbUrl = PLACEHOLDER_URL;
        let files: AttachmentBuilder[] = [makePlaceholderAttachment()];
        if (info.thumbnail) {
            const cached = thumbnailCdnCache.get(info.thumbnail);
            if (cached) {
                // Réutiliser l'URL CDN — pas de re-upload, pas de flickering
                thumbUrl = cached;
                files = [];
            } else {
                const thumbAttachment = await fetchThumbnailAttachment(info.thumbnail);
                if (thumbAttachment) {
                    thumbUrl = "attachment://thumb.jpg";
                    files = [thumbAttachment];
                }
            }
        }

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `## 💽 Nexa's Jukebox - Mode Requêtes`,
                    `*[${info.title}](${info.url})*`,
                    [
                        `${info.sourceEmoji} ${info.channel}`,
                        info.isLive ? `🔴 LIVE` : `⏱️ ${info.duration}`,
                        info.requestedBy ? `👤 ${info.requestedBy}` : null,
                    ].filter(Boolean).join(" · "),
                ].join("\n")
            )
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(thumbUrl))
        );
        if (!info.isLive) {
            const posMs = (player as any)?.position ?? 0;
            const durationMs = current.info.duration ?? 0;
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(buildProgressBar(posMs, durationMs))
            );
        }
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("nexa_prev").setLabel("⏮ Précédent").setStyle(ButtonStyle.Secondary).setDisabled(!hasHistory),
                new ButtonBuilder().setCustomId("nexa_playpause").setLabel(isPaused ? "▶️ Reprendre" : "⏸ Pause").setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary).setDisabled(!isPlaying),
                new ButtonBuilder().setCustomId("nexa_skip").setLabel("⏭ Suivant").setStyle(ButtonStyle.Secondary).setDisabled(!isPlaying),
                new ButtonBuilder().setCustomId("nexa_stop").setLabel("⏹ Arrêter").setStyle(ButtonStyle.Danger).setDisabled(!isPlaying),
            )
        );
        container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("nexa_seek_back").setLabel("⏪ -10s").setStyle(ButtonStyle.Secondary).setDisabled(!isPlaying || info.isLive),
                new ButtonBuilder().setCustomId("nexa_seek_forward").setLabel("+10s ⏩").setStyle(ButtonStyle.Secondary).setDisabled(!isPlaying || info.isLive),
                new ButtonBuilder().setCustomId("nexa_loop").setLabel(repeatMode === "off" ? "🔁 Boucle: Off" : repeatMode === "queue" ? "🔁 Boucle: Liste" : "🔂 Boucle: Titre").setStyle(repeatMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
                new ButtonBuilder().setCustomId("nexa_shuffle").setLabel("🔀 Mélanger").setStyle(ButtonStyle.Secondary).setDisabled(queue.length < 2),
            )
        );
        {
            const activeFilters = getActiveFilters(player!);
            const activeId = FILTERS.find(f => activeFilters.has(f.id))?.id ?? null;
            const options = [
                new StringSelectMenuOptionBuilder().setValue("nexa_filter_none").setLabel("Aucun filtre").setDescription("Désactiver tous les filtres").setEmoji("✖️").setDefault(activeId === null),
                ...FILTERS.map(f => new StringSelectMenuOptionBuilder().setValue(`nexa_filter_${f.id}`).setLabel(`${f.emoji} ${f.label}`).setDescription(f.description).setDefault(f.id === activeId)),
            ];
            container.addActionRowComponents(
                new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    new StringSelectMenuBuilder().setCustomId("nexa_filter_select").setPlaceholder("🎛️ Filtre audio…").setMinValues(1).setMaxValues(1).addOptions(options)
                )
            );
        }
        container.addSeparatorComponents(new SeparatorBuilder());
        {
            const prevTrack = history.length > 0 ? history[history.length - 1] : null;
            const nextTrack = queue.length > 0 ? queue[0] : null;
            const fmtLine = (t: Track, prefix: string) => {
                const inf = trackToDisplay(t);
                const title = inf.title.length > 46 ? inf.title.slice(0, 45) + "…" : inf.title;
                return `${prefix} ${title} (${inf.duration})`;
            };
            const currentTitle = info.title.length > 44 ? info.title.slice(0, 43) + "…" : info.title;

            // Si pas de track suivante, afficher "Fermeture du Jukebox" à la place
            const nextLine = nextTrack
                ? fmtLine(nextTrack, " ")
                : ` (Fermeture du Jukebox)`;

            const lines = [
                prevTrack ? fmtLine(prevTrack, " ") : " ",
                `‎ ‎ ‎ ▶ ${currentTitle} (${info.duration})`,
                nextLine,
            ];
            const posMs = (player as any)?.position ?? 0;
            const remainingMs = (current?.info.isStream ? 0 : Math.max(0, (current?.info.duration ?? 0) - posMs))
                + queue.reduce((acc, t) => acc + (t.info.isStream ? 0 : (t.info.duration ?? 0)), 0);
            const remainingFmt = info.isLive ? "∞" : fmt(remainingMs);
            const total = history.length + 1 + queue.length;
            const remaining = 1 + queue.length;
            const timeLabel = `(${remainingFmt} · ${remaining} titre${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""})`;
            const footer = `\n-# *${total} titre${total > 1 ? "s" : ""} au total*`;
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**📋 Liste de lecture** ${timeLabel}\n\`\`\`\n${lines.join("\n")}\n\`\`\`${footer}`)
            );
        }

        return {components: [container], flags: MessageFlags.IsComponentsV2, files};

    } else {
        const guildId = (player as any)?.guildId as string | undefined;
        const closingTimer = guildId ? getClosingTimer(guildId) : undefined;

        if (closingTimer) {
            const msLeft = Math.max(0, closingTimer.endsAt - Date.now());
            const secsLeft = Math.ceil(msLeft / 1000);
            const minsLeft = Math.floor(secsLeft / 60);
            const sLeft = secsLeft % 60;
            const countdown = minsLeft > 0 ? `${minsLeft}m${String(sLeft).padStart(2, "0")}s` : `${secsLeft}s`;
            const totalMs = 5 * 60 * 1000;
            const ratio = Math.min(1, Math.max(0, msLeft / totalMs));
            const filled = Math.round(ratio * BAR_WIDTH);
            const bar = "▰".repeat(filled) + "▱".repeat(BAR_WIDTH - filled);

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## 💽 Nexa's Jukebox - En fermeture`)
            );
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(PLACEHOLDER_URL))
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# ${bar}\n⏳ Fermeture dans **${countdown}** — Envoie une chanson pour continuer !`
                )
            );
            container.addSeparatorComponents(new SeparatorBuilder());
            // Row 1 : Reprendre (relance liste) + Stop actifs si historique, skip désactivé, loop désactivé
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId("nexa_prev").setLabel("⏮ Précédent").setStyle(ButtonStyle.Secondary).setDisabled(!hasHistory),
                    new ButtonBuilder().setCustomId("nexa_restart_queue").setLabel("▶️ Reprendre").setStyle(ButtonStyle.Success).setDisabled(!hasHistory),
                    new ButtonBuilder().setCustomId("nexa_skip").setLabel("⏭ Suivant").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_stop").setLabel("⏹ Arrêter").setStyle(ButtonStyle.Danger).setDisabled(!hasHistory),
                )
            );
            // Row 2 : seek désactivés + shuffle désactivé
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId("nexa_seek_back").setLabel("⏪ -10s").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_seek_forward").setLabel("+10s ⏩").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_loop").setLabel("🔁 Boucle: Off").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_shuffle").setLabel("🔀 Mélanger").setStyle(ButtonStyle.Secondary).setDisabled(true),
                )
            );
            // Select filtre désactivé mais avec le filtre actif affiché
            {
                const savedFilter = getSavedFilter(guildId!) ?? null;
                const filterOptions = [
                    new StringSelectMenuOptionBuilder().setValue("nexa_filter_none").setLabel("Aucun filtre").setDescription("Désactiver tous les filtres").setEmoji("✖️").setDefault(savedFilter === null),
                    ...FILTERS.map(f => new StringSelectMenuOptionBuilder().setValue(`nexa_filter_${f.id}`).setLabel(`${f.emoji} ${f.label}`).setDescription(f.description).setDefault(f.id === savedFilter)),
                ];
                container.addActionRowComponents(
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                        new StringSelectMenuBuilder().setCustomId("nexa_filter_select").setPlaceholder("🎛️ Filtre audio…").setDisabled(true).addOptions(filterOptions)
                    )
                );
            }
            container.addSeparatorComponents(new SeparatorBuilder());
            // Liste de lecture : toutes les chansons de l'historique + fermeture au milieu
            {
                const fmtLine = (t: Track, prefix: string) => {
                    const inf = trackToDisplay(t);
                    const title = inf.title.length > 46 ? inf.title.slice(0, 45) + "…" : inf.title;
                    return `${prefix} ${title} (${inf.duration})`;
                };
                const prevTrack = history.length > 0 ? history[history.length - 1] : null;
                const lines = [
                    prevTrack ? fmtLine(prevTrack, " ") : " ",
                    `‎ ‎ ‎ ▶ (Fermeture du Jukebox)`,
                    ` `,
                ];
                const total = history.length + 1;
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**📋 Liste de lecture** *(${total} titre${total > 1 ? "s" : ""} au total)*\n\`\`\`\n${lines.join("\n")}\n\`\`\``
                    )
                );
            }
            return {components: [container], flags: MessageFlags.IsComponentsV2, files: [makePlaceholderAttachment()]};

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
                    new ButtonBuilder().setCustomId("nexa_prev").setLabel("⏮ Précédent").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_playpause").setLabel("⏸️ Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_skip").setLabel("⏭ Suivant").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_stop").setLabel("⏹ Arrêter").setStyle(ButtonStyle.Danger).setDisabled(true),
                )
            );
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId("nexa_seek_back").setLabel("⏪ -10s").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_seek_forward").setLabel("+10s ⏩").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_loop").setLabel("🔁 Boucle: Off").setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId("nexa_shuffle").setLabel("🔀 Mélanger").setStyle(ButtonStyle.Secondary).setDisabled(true),
                )
            );
            container.addActionRowComponents(
                new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    new StringSelectMenuBuilder().setCustomId("nexa_filter_select").setPlaceholder("🎛️ Filtre audio…").setDisabled(true)
                        .addOptions([new StringSelectMenuOptionBuilder().setValue("nexa_filter_none").setLabel("Aucun filtre").setDescription("Désactiver tous les filtres").setEmoji("✖️").setDefault(true)])
                )
            );
            return {components: [container], flags: MessageFlags.IsComponentsV2, files: [makePlaceholderAttachment()]};
        }
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
                [
                    `### 🔍 Résultat trouvé`,
                    `**[${info.title}](${info.url})**`,
                    [
                        `${info.sourceEmoji} ${info.channel}`,
                        info.isLive ? `🔴 LIVE` : `⏱️ ${info.duration}`,
                        info.requestedBy ? `👤 ${info.requestedBy}` : null,
                    ].filter(Boolean).join(" · "),
                ].join("\n")
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
