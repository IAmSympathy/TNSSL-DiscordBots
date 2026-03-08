import {ActivityType, Client, VoiceChannel} from "discord.js";
import {createLogger} from "../utils/logger";

const logger = createLogger("VoiceChannelStatus");

// Rate limit Discord : 2 requêtes par 5 minutes par salon
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REQUESTS_PER_WINDOW = 2;

// Debounce pour regrouper les changements rapides avant d'envoyer
const DEBOUNCE_DELAY = 5000; // 5 secondes

interface ChannelRateState {
    requestTimestamps: number[];  // Timestamps des dernières requêtes
    debounceTimer?: NodeJS.Timeout;
    pendingUpdate: boolean;       // Une mise à jour est en attente (rate limited)
    pendingTimer?: NodeJS.Timeout;
}

const channelStates = new Map<string, ChannelRateState>();

function getChannelState(channelId: string): ChannelRateState {
    if (!channelStates.has(channelId)) {
        channelStates.set(channelId, {requestTimestamps: [], pendingUpdate: false});
    }
    return channelStates.get(channelId)!;
}

/**
 * Retourne le délai (ms) à attendre avant de pouvoir envoyer une requête,
 * ou 0 si on peut envoyer immédiatement.
 */
function getRateLimitDelay(state: ChannelRateState): number {
    const now = Date.now();
    // Purger les timestamps hors de la fenêtre
    state.requestTimestamps = state.requestTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

    if (state.requestTimestamps.length < MAX_REQUESTS_PER_WINDOW) return 0;

    // Attendre que le plus ancien timestamp sorte de la fenêtre
    const oldest = state.requestTimestamps[0];
    return RATE_LIMIT_WINDOW_MS - (now - oldest) + 500; // +500ms de marge
}

/**
 * Construit le statut du salon vocal en fonction des activités des membres
 */
function buildVoiceStatus(channel: VoiceChannel): string {
    const members = [...channel.members.values()].filter(m => !m.user.bot);

    if (members.length === 0) return "";

    // Seul en vocal
    if (members.length === 1) {
        const solo = members[0];
        if (solo.presence?.status === "idle") return `💤 ${solo.displayName} est AFK`;
        if (solo.voice.selfMute && solo.voice.selfDeaf) return `🔇 ${solo.displayName} attend en sourdine`;
        return `👋 ${solo.displayName} attend du monde !`;
    }

    const totalMembers = members.length;

    // --- Cas absent (idle) ---
    const idleMembers = members.filter(m => m.presence?.status === "idle");
    const nonIdle = members.filter(m => m.presence?.status !== "idle");

    if (idleMembers.length === totalMembers) {
        return `💤 Tout le monde est AFK`;
    }
    if (nonIdle.length === 1) {
        return `💤 ${nonIdle[0].displayName} est le seul actif`;
    }

    // --- Cas sourdine / mute ---
    // Un membre est "silencieux" s'il est mute (micro coupé) ET sourd (son coupé)
    const silentMembers = members.filter(m => m.voice.selfMute && m.voice.selfDeaf);
    const nonSilent = members.filter(m => !m.voice.selfMute || !m.voice.selfDeaf);

    if (silentMembers.length === totalMembers) {
        return `🔇 Tout le monde est en sourdine`;
    }
    if (nonSilent.length === 1) {
        return `🔇 ${nonSilent[0].displayName} parle dans le vide`;
    }

    // --- Collecter les activités par type, une seule fois par membre ---
    // Priorité : Playing > Streaming > Watching > Listening
    // Cela évite qu'un membre avec plusieurs activités soit compté plusieurs fois
    const ACTIVITY_PRIORITY = [
        ActivityType.Playing,
        ActivityType.Streaming,
        ActivityType.Watching,
        ActivityType.Listening,
    ];

    const gameCounts = new Map<string, number>();
    const streamers: typeof members = [];
    const listeners: typeof members = [];
    const watchers: typeof members = [];

    for (const member of members) {
        const activities = member.presence?.activities ?? [];

        // Trouver l'activité la plus prioritaire du membre
        let dominantType: ActivityType | null = null;
        let dominantName: string | null = null;
        for (const type of ACTIVITY_PRIORITY) {
            const found = activities.find(a => a.type === type);
            if (found) {
                dominantType = type;
                dominantName = found.name;
                break;
            }
        }

        if (dominantType === null) continue;

        switch (dominantType) {
            case ActivityType.Playing:
                gameCounts.set(dominantName!, (gameCounts.get(dominantName!) ?? 0) + 1);
                break;
            case ActivityType.Streaming:
                streamers.push(member);
                break;
            case ActivityType.Watching:
                watchers.push(member);
                break;
            case ActivityType.Listening:
                listeners.push(member);
                break;
        }
    }

    const sortedGames = [...gameCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topGameCount = sortedGames[0]?.[1] ?? 0;


    // --- Trouver l'activité la plus représentative (max membres impliqués, min 2) ---
    const scores: { count: number; type: string }[] = [
        {count: topGameCount, type: "game"},
        {count: streamers.length, type: "stream"},
        {count: listeners.length, type: "music"},
        {count: watchers.length, type: "watch"},
    ];
    const best = scores.sort((a, b) => b.count - a.count)[0];

    // Moins de 2 membres concernés → pas assez représentatif
    if (best.count < 2) return `🎙️ Chill en vocal`;

    // --- Construire le statut selon l'activité dominante ---
    switch (best.type) {
        case "game": {
            const [topGame, topCount] = sortedGames[0];

            if (sortedGames.length === 1 || sortedGames[1][1] < 2) {
                // Un seul jeu commun (ou seul avec 2+ joueurs)
                if (topCount === totalMembers) return `🎮 Tous sur ${topGame}`;
                return `🎮 ${topCount}/${totalMembers} sur ${topGame}`;
            }

            // Deux jeux distincts avec chacun 2+ joueurs
            const second = sortedGames[1][0];
            return `🎮 ${topCount} sur ${topGame} • ${second}...`;
        }


        case "stream": {
            // Chacun stream de son côté → générique
            return `🎙️ Chill en vocal`;
        }

        case "music": {
            // Chacun écoute de son côté → générique
            return `🎙️ Chill en vocal`;
        }

        case "watch": {
            // Chacun regarde de son côté → générique
            return `🎙️ Chill en vocal`;
        }
    }

    return `🎙️ Chill en vocal`;
}

/**
 * Envoie réellement le statut à Discord et enregistre le timestamp
 */
async function sendStatus(channel: VoiceChannel, state: ChannelRateState): Promise<void> {
    try {
        const status = buildVoiceStatus(channel);

        // discord.js 14 n'expose pas setStatus() — on passe par l'API REST directement
        await channel.client.rest.put(
            `/channels/${channel.id}/voice-status` as any,
            {body: {status}}
        );

        state.requestTimestamps.push(Date.now());
        state.pendingUpdate = false;

        logger.info(`Updated status of #${channel.name}: "${status || "(cleared)"}"`);
    } catch (error) {
        logger.error(`Failed to update voice channel status for #${channel.name}:`, error);
    }
}

/**
 * Met à jour le statut du salon vocal en respectant le rate limit Discord.
 * - Debounce de 5s pour regrouper les changements rapides
 * - Si rate limited, replanifie automatiquement quand la fenêtre se libère
 */
async function updateChannelStatus(channel: VoiceChannel): Promise<void> {
    const state = getChannelState(channel.id);

    // Annuler le debounce en cours
    if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = undefined;
    }

    state.debounceTimer = setTimeout(async () => {
        state.debounceTimer = undefined;

        const delay = getRateLimitDelay(state);

        if (delay === 0) {
            // Pas de rate limit, envoyer immédiatement
            if (state.pendingTimer) {
                clearTimeout(state.pendingTimer);
                state.pendingTimer = undefined;
                state.pendingUpdate = false;
            }
            await sendStatus(channel, state);
        } else {
            // Rate limited : planifier la mise à jour quand la fenêtre se libère
            if (state.pendingUpdate) {
                // Un timer est déjà en attente, la mise à jour sera envoyée au bon moment
                logger.debug(`#${channel.name} rate limited, update already queued (in ${Math.round(delay / 1000)}s)`);
                return;
            }

            state.pendingUpdate = true;
            logger.debug(`#${channel.name} rate limited, scheduling update in ${Math.round(delay / 1000)}s`);

            state.pendingTimer = setTimeout(async () => {
                state.pendingTimer = undefined;
                state.pendingUpdate = false;
                await sendStatus(channel, state);
            }, delay);
        }
    }, DEBOUNCE_DELAY);
}

/**
 * Enregistre le listener de présence et les mises à jour vocales
 * pour maintenir le statut du salon à jour
 */
export function registerVoiceChannelStatusUpdater(client: Client): void {
    logger.info("Voice channel status updater initialized");

    // Mise à jour quand un membre rejoint / quitte / change de salon
    client.on("voiceStateUpdate", async (oldState, newState) => {
        try {
            const affected = new Set<VoiceChannel>();

            if (oldState.channel?.isVoiceBased()) {
                affected.add(oldState.channel as VoiceChannel);
            }
            if (newState.channel?.isVoiceBased()) {
                affected.add(newState.channel as VoiceChannel);
            }

            for (const channel of affected) {
                const humanMembers = [...channel.members.values()].filter(m => !m.user.bot);
                if (humanMembers.length === 0) continue; // Salon vide → pas besoin de set le statut
                await updateChannelStatus(channel);
            }
        } catch (error) {
            logger.error("Error in voiceStateUpdate handler (status updater):", error);
        }
    });

    // Mise à jour quand la présence d'un membre change (nouveau jeu, etc.)
    client.on("presenceUpdate", async (_oldPresence, newPresence) => {
        try {
            if (!newPresence?.guild) return;

            const member = await newPresence.guild.members.fetch(newPresence.userId).catch(() => null);
            if (!member) return;

            const voiceChannel = member.voice?.channel;
            if (!voiceChannel?.isVoiceBased()) return;

            await updateChannelStatus(voiceChannel as VoiceChannel);
        } catch (error) {
            logger.error("Error in presenceUpdate handler (status updater):", error);
        }
    });
}







