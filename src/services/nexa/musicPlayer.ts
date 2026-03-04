/**
 * Nexa - Lecteur audio via Lavalink + lavalink-client
 * Tourne dans le processus Node de Netricsa (pas de PM2 séparé).
 */

import {LavalinkManager, type LavalinkNodeOptions, type Player, type Track} from "lavalink-client";
import type {Client} from "discord.js";

export type KazagumoPlayer = Player;
export type KazagumoTrack = Track;

export function getLavalinkNodes(): LavalinkNodeOptions[] {
    return [{
        id: "main",
        host: process.env.LAVALINK_HOST ?? "127.0.0.1",
        port: parseInt(process.env.LAVALINK_PORT ?? "2333"),
        authorization: process.env.LAVALINK_PASSWORD ?? "youshallnotpass",
        secure: false,
        retryAmount: 20,
        retryDelay: 5000,
    }];
}

let manager: LavalinkManager | null = null;

/** Initialise LavalinkManager avec le client Netricsa (Nexa se connecte via lui) */
export function initKazagumo(client: Client): LavalinkManager {
    if (manager) return manager;

    manager = new LavalinkManager({
        nodes: getLavalinkNodes(),
        sendToShard: (guildId, payload) => {
            client.guilds.cache.get(guildId)?.shard?.send(payload);
        },
        autoSkip: true,
        client: {
            id: client.user?.id ?? process.env.NEXA_CLIENT_ID ?? "",
            username: "Nexa",
        },
        playerOptions: {
            defaultSearchPlatform: "ytsearch",
            onDisconnect: {autoReconnect: true, destroyPlayer: false},
        },
    });

    manager.nodeManager.on("connect", (node) => {
        console.log(`[Nexa] ✅ Lavalink node "${node.id}" connecté`);
    });
    manager.nodeManager.on("disconnect", (node, reason) => {
        console.warn(`[Nexa] ⚠️ Node "${node.id}" déconnecté`, reason);
    });
    manager.nodeManager.on("error", (node, error) => {
        console.error(`[Nexa] ❌ Node "${node.id}" erreur: ${error.message}`);
    });

    return manager;
}

export async function isLavalinkReady(): Promise<boolean> {
    const host = process.env.LAVALINK_HOST ?? "127.0.0.1";
    const port = process.env.LAVALINK_PORT ?? "2333";
    const password = process.env.LAVALINK_PASSWORD ?? "youshallnotpass";
    try {
        const http = await import("http");
        return await new Promise<boolean>((resolve) => {
            const req = http.request(
                {hostname: host, port: parseInt(port), path: "/version", method: "GET", headers: {Authorization: password}, timeout: 3000},
                (res) => resolve(res.statusCode === 200)
            );
            req.on("error", () => resolve(false));
            req.on("timeout", () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        });
    } catch {
        return false;
    }
}

export function getKazagumo(): LavalinkManager {
    if (!manager) throw new Error("[Nexa] LavalinkManager non initialisé");
    return manager;
}

export async function getOrCreatePlayer(guildId: string, voiceChannelId: string, textChannelId: string): Promise<Player> {
    const m = getKazagumo();
    const existing = m.getPlayer(guildId);
    if (existing) return existing;
    return await m.createPlayer({guildId, voiceChannelId, textChannelId, volume: 80, selfDeaf: true, selfMute: false});
}

export async function searchTrack(query: string, guildId: string, voiceChannelId: string, textChannelId: string, requestUser: unknown): Promise<{ player: Player; track: Track; tracks: Track[] } | null> {
    try {
        const player = await getOrCreatePlayer(guildId, voiceChannelId, textChannelId);
        const result = await player.search({query}, requestUser);
        if (!result?.tracks.length) return null;
        const tracks = result.tracks.slice(0, 6) as Track[];
        return {player, track: tracks[0], tracks};
    } catch (err) {
        console.error("[Nexa] Erreur recherche:", err);
        return null;
    }
}

export async function togglePause(guildId: string): Promise<"paused" | "resumed" | "no_player"> {
    const player = getKazagumo().getPlayer(guildId);
    if (!player) return "no_player";
    if (player.paused) {
        await player.resume();
        return "resumed";
    } else {
        await player.pause();
        return "paused";
    }
}

// Historique des tracks jouées par guildId (max 50)
const trackHistory = new Map<string, Track[]>();
// Flag pour ignorer le prochain trackEnd/trackStart lors d'un previous
const skipNextPush = new Set<string>();

export function pushHistory(guildId: string, track: Track): void {
    if (skipNextPush.has(guildId)) {
        skipNextPush.delete(guildId);
        return;
    }
    const hist = trackHistory.get(guildId) ?? [];
    hist.push(track);
    if (hist.length > 50) hist.shift();
    trackHistory.set(guildId, hist);
}

export function getHistory(guildId: string): Track[] {
    return trackHistory.get(guildId) ?? [];
}

export async function skipTrack(guildId: string): Promise<void> {
    const player = getKazagumo().getPlayer(guildId);
    if (player) await player.skip();
}

export async function previousTrack(guildId: string): Promise<void> {
    const player = getKazagumo().getPlayer(guildId);
    if (!player) return;
    const hist = trackHistory.get(guildId) ?? [];
    if (!hist.length) return;
    const prev = hist.pop()!;
    trackHistory.set(guildId, hist);

    // Remettre la track courante en tête de file SANS la re-pousser dans l'historique
    skipNextPush.add(guildId);
    if (player.queue.current) player.queue.add(player.queue.current, 0);
    await player.play({track: prev});
}

export async function stopPlayback(guildId: string): Promise<void> {
    const player = getKazagumo().getPlayer(guildId);
    if (player) await player.destroy();
}

export async function setVolume(guildId: string, volume: number): Promise<void> {
    const player = getKazagumo().getPlayer(guildId);
    if (player) await player.setVolume(Math.max(0, Math.min(100, volume)));
}

