import {Activity, Client, GuildChannel} from "discord.js";
import {createLogger} from "../utils/logger";
import {EnvConfig} from "../utils/envConfig";
import {Rcon} from "rcon-client";
import {promises as fs} from "fs";
import path from "path";

const logger = createLogger("MinecraftOnlineChannelService");

const DEFAULT_STATUS_SOURCE_USER_ID = "1482105326021906432";
const DEFAULT_CHANNEL_ID = "1481902621005713530";
const CHUNKY_STATE_FILE_PATH = path.resolve(process.cwd(), "data", "chunky_automation_state.json");

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_RENAMES_PER_WINDOW = 2;
const RATE_LIMIT_SAFETY_MS = 1000;

const renameTimestamps: number[] = [];
let pendingName: string | null = null;
let pendingRenameTimer: NodeJS.Timeout | null = null;
let chunkyAutomationInFlight = false;
let lastChunkyAutomationAt = 0;
let chunkyMarkedUnavailable = false;
let chunkyPauseIssuedForActivePlayers = false;
let chunkyCurrentWorldIndex = 0;
let chunkyAllWorldsCompletedLogged = false;
const chunkyStartedWorlds = new Set<string>();
const chunkyCompletedWorlds = new Set<string>();
let chunkyStateLoaded = false;
let chunkyStateInitPromise: Promise<void> | null = null;
let chunkyStateSaveInFlight = false;
let chunkyStateSaveQueued = false;
let lastOnlinePlayersSnapshot = 0;

type OnlineSnapshot = {
    onlinePlayers: number;
    players: string[];
};

type ChunkyWorldSelectState = "selected" | "invalid-world" | "plugin-missing" | "unknown";
type ChunkyContinueState = "continued" | "already-running" | "no-task" | "unknown";
type ChunkyPauseState = "paused" | "already-paused" | "no-task" | "unknown";
type ChunkyStartState = "started" | "already-running" | "failed";
type ChunkyWorldTaskState = "running" | "started" | "completed" | "waiting-cooldown" | "failed" | "unavailable";

type ChunkyPersistedState = {
    version: 1;
    lastChunkyAutomationAt: number;
    chunkyMarkedUnavailable: boolean;
    chunkyPauseIssuedForActivePlayers: boolean;
    chunkyCurrentWorldIndex: number;
    chunkyStartedWorlds: string[];
    chunkyCompletedWorlds: string[];
};

function getChunkyPersistedStateSnapshot(): ChunkyPersistedState {
    return {
        version: 1,
        lastChunkyAutomationAt,
        chunkyMarkedUnavailable,
        chunkyPauseIssuedForActivePlayers,
        chunkyCurrentWorldIndex,
        chunkyStartedWorlds: Array.from(chunkyStartedWorlds),
        chunkyCompletedWorlds: Array.from(chunkyCompletedWorlds),
    };
}

async function saveChunkyStateToDisk(): Promise<void> {
    if (!chunkyStateLoaded) {
        return;
    }

    if (chunkyStateSaveInFlight) {
        chunkyStateSaveQueued = true;
        return;
    }

    chunkyStateSaveInFlight = true;
    try {
        do {
            chunkyStateSaveQueued = false;
            const state = getChunkyPersistedStateSnapshot();
            await fs.mkdir(path.dirname(CHUNKY_STATE_FILE_PATH), {recursive: true});
            await fs.writeFile(CHUNKY_STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
        } while (chunkyStateSaveQueued);
    } catch (error) {
        logger.warn("[Minecraft] Impossible de sauvegarder l'état Chunky:", error);
    } finally {
        chunkyStateSaveInFlight = false;
    }
}

function markChunkyStateDirty(): void {
    void saveChunkyStateToDisk();
}

async function loadChunkyStateFromDisk(): Promise<void> {
    try {
        const raw = await fs.readFile(CHUNKY_STATE_FILE_PATH, "utf8");
        const parsed = JSON.parse(raw) as Partial<ChunkyPersistedState>;

        if (typeof parsed.lastChunkyAutomationAt === "number" && Number.isFinite(parsed.lastChunkyAutomationAt)) {
            lastChunkyAutomationAt = parsed.lastChunkyAutomationAt;
        }

        if (typeof parsed.chunkyMarkedUnavailable === "boolean") {
            chunkyMarkedUnavailable = parsed.chunkyMarkedUnavailable;
        }

        if (typeof parsed.chunkyPauseIssuedForActivePlayers === "boolean") {
            chunkyPauseIssuedForActivePlayers = parsed.chunkyPauseIssuedForActivePlayers;
        }

        if (typeof parsed.chunkyCurrentWorldIndex === "number" && Number.isInteger(parsed.chunkyCurrentWorldIndex) && parsed.chunkyCurrentWorldIndex >= 0) {
            chunkyCurrentWorldIndex = parsed.chunkyCurrentWorldIndex;
        }

        chunkyStartedWorlds.clear();
        for (const world of Array.isArray(parsed.chunkyStartedWorlds) ? parsed.chunkyStartedWorlds : []) {
            if (typeof world === "string" && world.trim().length > 0) {
                chunkyStartedWorlds.add(world);
            }
        }

        chunkyCompletedWorlds.clear();
        for (const world of Array.isArray(parsed.chunkyCompletedWorlds) ? parsed.chunkyCompletedWorlds : []) {
            if (typeof world === "string" && world.trim().length > 0) {
                chunkyCompletedWorlds.add(world);
            }
        }

        logger.info(`[Minecraft] Etat Chunky rechargé depuis ${CHUNKY_STATE_FILE_PATH}`);
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            logger.warn("[Minecraft] Etat Chunky illisible, démarrage avec état vierge:", error);
        }
    } finally {
        chunkyStateLoaded = true;
    }
}

function normalizeChunkyResponse(response: string): string {
    return response.trim().toLowerCase();
}

function isChunkyPluginMissingResponse(response: string): boolean {
    const normalized = normalizeChunkyResponse(response);
    return normalized.includes("unknown or incomplete command")
        || normalized.includes("unknown command")
        || normalized.includes("chunky is not installed")
        || normalized.includes("no such command")
        || normalized.includes("not recognized");
}

function isChunkyInvalidWorldResponse(response: string): boolean {
    const normalized = normalizeChunkyResponse(response);
    return normalized.includes("unknown world")
        || normalized.includes("world does not exist")
        || normalized.includes("world not found")
        || normalized.includes("could not find world")
        || normalized.includes("invalid world")
        || normalized.includes("invalid dimension")
        || normalized.includes("no world named");
}

function classifyChunkyWorldResponse(response: string): ChunkyWorldSelectState {
    if (isChunkyPluginMissingResponse(response)) {
        return "plugin-missing";
    }

    if (isChunkyInvalidWorldResponse(response)) {
        return "invalid-world";
    }

    const normalized = normalizeChunkyResponse(response);
    if (
        normalized.includes("selected world")
        || normalized.includes("world set")
        || normalized.includes("using world")
        || normalized.includes("current world")
    ) {
        return "selected";
    }

    return "unknown";
}

function classifyChunkyContinueResponse(response: string): ChunkyContinueState {
    const normalized = normalizeChunkyResponse(response);

    if (normalized.includes("already running") || normalized.includes("already generating")) {
        return "already-running";
    }

    if (
        normalized.includes("continu")
        || normalized.includes("resum")
        || normalized.includes("task will continue")
    ) {
        return "continued";
    }

    if (
        normalized.includes("no task")
        || normalized.includes("nothing to continue")
        || normalized.includes("no chunks selected")
        || normalized.includes("no selection")
        || normalized.includes("completed")
        || normalized.includes("done")
    ) {
        return "no-task";
    }

    return "unknown";
}

function classifyChunkyStartResponse(response: string): ChunkyStartState {
    const normalized = normalizeChunkyResponse(response);

    if (normalized.includes("already running") || normalized.includes("already generating")) {
        return "already-running";
    }

    if (
        normalized.includes("started")
        || normalized.includes("start")
        || normalized.includes("generating")
        || normalized.includes("task queued")
    ) {
        return "started";
    }

    return "failed";
}

function classifyChunkyPauseResponse(response: string): ChunkyPauseState {
    const normalized = normalizeChunkyResponse(response);

    if (normalized.includes("already paused") || normalized.includes("is paused")) {
        return "already-paused";
    }

    if (
        normalized.includes("paused")
        || normalized.includes("pausing")
    ) {
        return "paused";
    }

    if (
        normalized.includes("no task")
        || normalized.includes("nothing to pause")
        || normalized.includes("not running")
        || normalized.includes("no chunk generation")
        || normalized.includes("no chunks selected")
    ) {
        return "no-task";
    }

    return "unknown";
}

function getChunkyWorldsToProcess(): string[] {
    const configuredWorlds = EnvConfig.MINECRAFT_CHUNKY_WORLDS;
    if (configuredWorlds.length > 0) {
        return configuredWorlds;
    }
    return ["world", "the_nether", "the_end"];
}

function getChunkyWorldCandidates(worldName: string): string[] {
    const normalized = worldName.trim().toLowerCase();
    const aliasesByWorld: Record<string, string[]> = {
        "world": ["world", "overworld", "minecraft:overworld"],
        "overworld": ["overworld", "world", "minecraft:overworld"],
        "minecraft:overworld": ["minecraft:overworld", "overworld", "world"],
        "world_nether": ["world_nether", "the_nether", "nether", "minecraft:the_nether"],
        "the_nether": ["the_nether", "nether", "minecraft:the_nether", "world_nether"],
        "nether": ["nether", "the_nether", "minecraft:the_nether", "world_nether"],
        "minecraft:the_nether": ["minecraft:the_nether", "the_nether", "nether", "world_nether"],
        "world_the_end": ["world_the_end", "the_end", "end", "minecraft:the_end"],
        "the_end": ["the_end", "end", "minecraft:the_end", "world_the_end"],
        "end": ["end", "the_end", "minecraft:the_end", "world_the_end"],
        "minecraft:the_end": ["minecraft:the_end", "the_end", "end", "world_the_end"],
        "the_everbright": ["the_everbright", "everbright", "blueskies:everbright", "world_the_everbright"],
        "everbright": ["everbright", "the_everbright", "blueskies:everbright", "world_the_everbright"],
        "blueskies:everbright": ["blueskies:everbright", "the_everbright", "everbright", "world_the_everbright"],
        "world_the_everbright": ["world_the_everbright", "the_everbright", "everbright", "blueskies:everbright"],
        "the_everdawn": ["the_everdawn", "everdawn", "blueskies:everdawn", "world_the_everdawn"],
        "everdawn": ["everdawn", "the_everdawn", "blueskies:everdawn", "world_the_everdawn"],
        "blueskies:everdawn": ["blueskies:everdawn", "the_everdawn", "everdawn", "world_the_everdawn"],
        "world_the_everdawn": ["world_the_everdawn", "the_everdawn", "everdawn", "blueskies:everdawn"],
        "the_nexus": ["the_nexus", "nexus", "minecraft:the_nexus", "world_the_nexus"],
        "nexus": ["nexus", "the_nexus", "minecraft:the_nexus", "world_the_nexus"],
        "minecraft:the_nexus": ["minecraft:the_nexus", "the_nexus", "nexus", "world_the_nexus"],
        "world_the_nexus": ["world_the_nexus", "the_nexus", "nexus", "minecraft:the_nexus"],
    };

    const aliases = aliasesByWorld[normalized] || [worldName.trim()];
    return Array.from(new Set(aliases));
}

async function withRconConnection<T>(operation: (rcon: Rcon) => Promise<T>): Promise<T> {
    const rcon = await Rcon.connect({
        host: EnvConfig.MINECRAFT_RCON_HOST,
        port: EnvConfig.MINECRAFT_RCON_PORT,
        password: EnvConfig.MINECRAFT_RCON_PASSWORD,
        timeout: EnvConfig.MINECRAFT_RCON_TIMEOUT_MS,
    });

    try {
        return await operation(rcon);
    } finally {
        await rcon.end().catch(() => undefined);
    }
}

async function sendRconCommand(rcon: Rcon, command: string): Promise<string> {
    const response = await rcon.send(command);
    if (isChunkyPluginMissingResponse(response) && !chunkyMarkedUnavailable) {
        chunkyMarkedUnavailable = true;
        markChunkyStateDirty();
    }
    return response;
}

function getNextPendingWorldIndex(worlds: string[], startAt: number): number {
    if (worlds.length === 0) {
        return -1;
    }

    for (let offset = 0; offset < worlds.length; offset += 1) {
        const index = (startAt + offset) % worlds.length;
        if (!chunkyCompletedWorlds.has(worlds[index])) {
            return index;
        }
    }

    return -1;
}

async function ensureChunkyTaskForWorld(rcon: Rcon, worldName: string, radius: number, allowStart: boolean): Promise<ChunkyWorldTaskState> {
    const worldCandidates = getChunkyWorldCandidates(worldName);
    let selectedWorldName: string | null = null;

    for (const worldCandidate of worldCandidates) {
        const worldResponse = await sendRconCommand(rcon, `chunky world ${worldCandidate}`);
        const worldState = classifyChunkyWorldResponse(worldResponse);

        if (worldState === "plugin-missing") {
            logger.warn("[Minecraft] Chunky introuvable via RCON. Automatisation Chunky désactivée jusqu'au redémarrage.");
            return "unavailable";
        }

        if (worldState === "invalid-world") {
            continue;
        }

        selectedWorldName = worldCandidate;
        if (worldState === "unknown") {
            logger.warn(`[Minecraft] Chunky ${worldName}: réponse inattendue à 'chunky world ${worldCandidate}': ${worldResponse}`);
        }
        break;
    }

    if (!selectedWorldName) {
        logger.warn(`[Minecraft] Chunky ${worldName}: impossible de sélectionner le monde (tentatives: ${worldCandidates.join(", ")})`);
        return "failed";
    }

    const continueResponse = await sendRconCommand(rcon, "chunky continue");
    if (chunkyMarkedUnavailable) {
        logger.warn("[Minecraft] Chunky introuvable pendant 'chunky continue'. Automatisation Chunky désactivée jusqu'au redémarrage.");
        return "unavailable";
    }

    const continueState = classifyChunkyContinueResponse(continueResponse);
    if (continueState === "continued" || continueState === "already-running") {
        chunkyStartedWorlds.add(worldName);
        markChunkyStateDirty();
        logger.info(`[Minecraft] Chunky ${worldName} (${selectedWorldName}): ${continueState === "continued" ? "continue" : "déjà en cours"}`);
        return "running";
    }

    if (continueState === "no-task" && chunkyStartedWorlds.has(worldName)) {
        chunkyStartedWorlds.delete(worldName);
        chunkyCompletedWorlds.add(worldName);
        markChunkyStateDirty();
        logger.info(`[Minecraft] Chunky ${worldName} (${selectedWorldName}): dimension terminée`);
        return "completed";
    }

    if (continueState === "unknown") {
        logger.warn(`[Minecraft] Chunky ${worldName} (${selectedWorldName}): réponse inattendue à 'chunky continue': ${continueResponse}`);
    }

    if (!allowStart) {
        return "waiting-cooldown";
    }

    await sendRconCommand(rcon, `chunky radius ${radius}`);
    if (chunkyMarkedUnavailable) {
        logger.warn("[Minecraft] Chunky introuvable pendant 'chunky radius'. Automatisation Chunky désactivée jusqu'au redémarrage.");
        return "unavailable";
    }

    const startResponse = await sendRconCommand(rcon, "chunky start");
    if (chunkyMarkedUnavailable) {
        logger.warn("[Minecraft] Chunky introuvable pendant 'chunky start'. Automatisation Chunky désactivée jusqu'au redémarrage.");
        return "unavailable";
    }

    const startState = classifyChunkyStartResponse(startResponse);

    if (startState === "started") {
        chunkyStartedWorlds.add(worldName);
        markChunkyStateDirty();
        logger.info(`[Minecraft] Chunky ${worldName} (${selectedWorldName}): nouvelle tâche démarrée (radius ${radius})`);
        return "started";
    }

    if (startState === "already-running") {
        chunkyStartedWorlds.add(worldName);
        markChunkyStateDirty();
        logger.info(`[Minecraft] Chunky ${worldName} (${selectedWorldName}): tâche déjà en cours`);
        return "running";
    }

    logger.warn(`[Minecraft] Chunky ${worldName} (${selectedWorldName}): impossible de démarrer la tâche. Réponse: ${startResponse}`);
    return "failed";
}

async function handleChunkyAutomation(snapshot: OnlineSnapshot): Promise<void> {
    if (!EnvConfig.MINECRAFT_CHUNKY_AUTOMATION_ENABLED) {
        return;
    }

    if (snapshot.onlinePlayers > 0) {
        return;
    }

    if (!EnvConfig.MINECRAFT_RCON_PASSWORD) {
        return;
    }

    if (chunkyMarkedUnavailable) {
        return;
    }

    if (chunkyAutomationInFlight) {
        return;
    }

    const cooldownMs = Math.max(60_000, EnvConfig.MINECRAFT_CHUNKY_COOLDOWN_MS);
    const now = Date.now();

    const radius = Math.max(3501, EnvConfig.MINECRAFT_CHUNKY_IDLE_RADIUS);
    const worlds = getChunkyWorldsToProcess();
    if (worlds.length === 0) {
        return;
    }

    const activeWorldSet = new Set(worlds);
    let stateChangedByWorldPruning = false;
    for (const world of Array.from(chunkyStartedWorlds)) {
        if (!activeWorldSet.has(world)) {
            chunkyStartedWorlds.delete(world);
            stateChangedByWorldPruning = true;
        }
    }
    for (const world of Array.from(chunkyCompletedWorlds)) {
        if (!activeWorldSet.has(world)) {
            chunkyCompletedWorlds.delete(world);
            stateChangedByWorldPruning = true;
        }
    }
    if (stateChangedByWorldPruning) {
        markChunkyStateDirty();
    }

    const nextPendingIndex = getNextPendingWorldIndex(worlds, chunkyCurrentWorldIndex);
    if (nextPendingIndex < 0) {
        if (!chunkyAllWorldsCompletedLogged) {
            logger.info(`[Minecraft] Chunky: toutes les dimensions configurées sont terminées (${worlds.join(", ")})`);
            chunkyAllWorldsCompletedLogged = true;
        }
        return;
    }

    chunkyAllWorldsCompletedLogged = false;
    chunkyCurrentWorldIndex = nextPendingIndex;
    markChunkyStateDirty();
    const worldName = worlds[chunkyCurrentWorldIndex];

    chunkyAutomationInFlight = true;

    try {
        // Let chunky continue/resume immediately after players leave;
        // throttle only brand-new chunky start operations.
        const allowStart = now - lastChunkyAutomationAt >= cooldownMs;
        await withRconConnection(async (rcon) => {
            const taskState = await ensureChunkyTaskForWorld(rcon, worldName, radius, allowStart);
            if (taskState === "started") {
                lastChunkyAutomationAt = Date.now();
                markChunkyStateDirty();
                return;
            }

            if (taskState === "completed") {
                const nextIndex = getNextPendingWorldIndex(worlds, chunkyCurrentWorldIndex + 1);
                chunkyCurrentWorldIndex = nextIndex >= 0 ? nextIndex : 0;
                markChunkyStateDirty();
                return;
            }

            if (taskState === "waiting-cooldown") {
                logger.info(`[Minecraft] Chunky ${worldName}: attente cooldown avant nouveau start (${Math.ceil((cooldownMs - (now - lastChunkyAutomationAt)) / 1000)}s)`);
            }
        });
    } catch (error) {
        logger.warn("[Minecraft] Erreur pendant l'automatisation Chunky:", error);
    } finally {
        chunkyAutomationInFlight = false;
    }
}

async function handleChunkyPauseOnPlayersOnline(snapshot: OnlineSnapshot): Promise<void> {
    if (!EnvConfig.MINECRAFT_CHUNKY_AUTOMATION_ENABLED) {
        return;
    }

    // Vérifier la transition 0 -> 1+ joueurs
    const wasNoPlayersOnline = lastOnlinePlayersSnapshot === 0;
    const arePlayersOnline = snapshot.onlinePlayers > 0;
    const playerCountChanged = lastOnlinePlayersSnapshot !== snapshot.onlinePlayers;
    
    lastOnlinePlayersSnapshot = snapshot.onlinePlayers;

    // Si transition 0 -> 1+, il faut faire la pause
    if (arePlayersOnline && (!wasNoPlayersOnline || !playerCountChanged)) {
        // Déjà en mode "joueurs en ligne", aucune action nécessaire
        return;
    }

    if (arePlayersOnline && wasNoPlayersOnline) {
        // Transition 0 -> 1+ : faire la pause
        if (!EnvConfig.MINECRAFT_RCON_PASSWORD) {
            return;
        }

        if (chunkyMarkedUnavailable) {
            return;
        }

        try {
            await withRconConnection(async (rcon) => {
                const pauseResponse = await sendRconCommand(rcon, "chunky pause");
                if (chunkyMarkedUnavailable) {
                    logger.warn("[Minecraft] Chunky introuvable via RCON pendant 'chunky pause'. Automatisation désactivée jusqu'au redémarrage.");
                    return;
                }

                const pauseState = classifyChunkyPauseResponse(pauseResponse);
                if (pauseState === "paused" || pauseState === "already-paused" || pauseState === "no-task") {
                    chunkyPauseIssuedForActivePlayers = true;
                    markChunkyStateDirty();
                    logger.info(`[Minecraft] Chunky pausé lors de l'arrivée de joueurs (${snapshot.onlinePlayers}) : ${pauseState}`);
                    return;
                }

                logger.warn(`[Minecraft] Chunky pause: réponse inattendue: ${pauseResponse}`);
            });
        } catch (error) {
            logger.warn("[Minecraft] Erreur pendant la pause automatique Chunky:", error);
        }
        return;
    }

    if (!arePlayersOnline && wasNoPlayersOnline) {
        // Reste en 0 joueurs
        if (chunkyPauseIssuedForActivePlayers) {
            chunkyPauseIssuedForActivePlayers = false;
            markChunkyStateDirty();
        }
        return;
    }
}

function extractOnlinePlayersFromActivities(activities: readonly Activity[]): number | null {
    const patterns = [
        /(\d+)\s*\/\s*\d+\s*(?:in simulation?|players?)/i,
        /(?:online|en\s+ligne)\s*[:\-]?\s*(\d+)/i,
        /(\d+)\s*(?:in simulation?|players?)\s*(?:online|en\s+ligne)?/i,
    ];

    for (const activity of activities) {
        const candidates = [activity.name, activity.state, activity.details];
        for (const value of candidates) {
            if (!value) continue;
            for (const pattern of patterns) {
                const match = value.match(pattern);
                if (!match) continue;
                const onlinePlayers = parseInt(match[1], 10);
                if (!Number.isNaN(onlinePlayers) && onlinePlayers >= 0) {
                    return onlinePlayers;
                }
            }
        }
    }

    return null;
}

async function updateMinecraftOnlineChannel(client: Client, onlinePlayers: number): Promise<void> {
    const expectedName = `👥 En ligne : ${onlinePlayers}`;
    await tryRenameMinecraftChannel(client, expectedName);
}

function buildPlayersTopic(snapshot: OnlineSnapshot): string {
    if (snapshot.onlinePlayers <= 0) {
        return "En ligne (0) : Aucun";
    }

    if (snapshot.players.length === 0) {
        return `En ligne (${snapshot.onlinePlayers})`;
    }

    const base = `En ligne (${snapshot.onlinePlayers}) : `;
    const joinedPlayers = snapshot.players.join(", ");
    const maxLength = 1024;
    const rawTopic = `${base}${joinedPlayers}`;

    if (rawTopic.length <= maxLength) {
        return rawTopic;
    }

    return `${rawTopic.slice(0, maxLength - 3)}...`;
}

async function updateMinecraftPlayersTopic(client: Client, snapshot: OnlineSnapshot): Promise<void> {
    const topicChannelId = EnvConfig.MINECRAFT_ONLINE_TOPIC_CHANNEL_ID || EnvConfig.MINECRAFT_ONLINE_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    const channel = await client.channels.fetch(topicChannelId).catch(() => null);

    if (!channel) {
        logger.warn(`[Minecraft] Salon topic ${topicChannelId} introuvable`);
        return;
    }

    if (typeof (channel as any).setTopic !== "function") {
        logger.warn(`[Minecraft] Le salon ${topicChannelId} ne supporte pas setTopic()`);
        return;
    }

    const expectedTopic = buildPlayersTopic(snapshot);
    const currentTopic = typeof (channel as any).topic === "string" ? (channel as any).topic : "";
    if (currentTopic === expectedTopic) {
        return;
    }

    await (channel as any).setTopic(expectedTopic);
}

function parsePlayersFromRconListResponse(response: string): OnlineSnapshot | null {
    const trimmed = response.trim();

    const englishFormat = trimmed.match(/^There are\s+(\d+)\s+of a max of\s+\d+\s+players online:?\s*(.*)$/i);
    if (englishFormat) {
        const onlinePlayers = parseInt(englishFormat[1], 10);
        const playersRaw = englishFormat[2]?.trim() || "";
        const players = playersRaw ? playersRaw.split(",").map(name => name.trim()).filter(Boolean) : [];
        return {onlinePlayers, players};
    }

    const countFallback = trimmed.match(/(\d+)/);
    if (!countFallback) {
        return null;
    }

    const onlinePlayers = parseInt(countFallback[1], 10);
    if (Number.isNaN(onlinePlayers) || onlinePlayers < 0) {
        return null;
    }

    const maybePlayersRaw = trimmed.includes(":") ? trimmed.split(":").slice(1).join(":").trim() : "";
    const players = maybePlayersRaw ? maybePlayersRaw.split(",").map(name => name.trim()).filter(Boolean) : [];

    return {onlinePlayers, players};
}

function pruneRenameTimestamps(now: number): void {
    while (renameTimestamps.length > 0 && now - renameTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
        renameTimestamps.shift();
    }
}

function getRequiredDelayBeforeRename(now: number): number {
    pruneRenameTimestamps(now);

    if (renameTimestamps.length < MAX_RENAMES_PER_WINDOW) {
        return 0;
    }

    const oldestRenameTs = renameTimestamps[0];
    return Math.max(0, (oldestRenameTs + RATE_LIMIT_WINDOW_MS + RATE_LIMIT_SAFETY_MS) - now);
}

function recordRename(now: number): void {
    renameTimestamps.push(now);
    pruneRenameTimestamps(now);
}

async function getTargetGuildChannel(client: Client): Promise<GuildChannel | null> {
    const channelId = EnvConfig.MINECRAFT_ONLINE_CHANNEL_ID || DEFAULT_CHANNEL_ID;

    const channel = await client.channels.fetch(channelId);
    if (!channel) {
        logger.warn(`[Minecraft] Channel ${channelId} introuvable`);
        return null;
    }

    if (!("guild" in channel) || typeof (channel as any).setName !== "function") {
        logger.warn(`[Minecraft] Channel ${channelId} n'est pas renommable`);
        return null;
    }

    return channel as GuildChannel;
}

async function resolveOnlinePlayersFromSourcePresence(client: Client): Promise<number | null> {
    const guildChannel = await getTargetGuildChannel(client);
    if (!guildChannel) return null;

    const sourceUserId = EnvConfig.MINECRAFT_STATUS_SOURCE_USER_ID || DEFAULT_STATUS_SOURCE_USER_ID;
    const sourceMember = await guildChannel.guild.members.fetch(sourceUserId).catch(() => null);
    if (!sourceMember) {
        logger.warn(`[Minecraft] Source presence introuvable (userId: ${sourceUserId})`);
        return null;
    }

    const activities = sourceMember.presence?.activities ?? [];
    if (activities.length === 0) {
        logger.warn(`[Minecraft] Aucune activité de présence détectée pour ${sourceMember.user.username} (${sourceUserId})`);
        return null;
    }

    const onlinePlayers = extractOnlinePlayersFromActivities(activities);
    if (onlinePlayers === null) {
        logger.warn(`[Minecraft] Impossible d'extraire X depuis les activités de présence de ${sourceMember.user.username}`);
        return null;
    }

    return onlinePlayers;
}

async function resolveOnlineSnapshotFromRcon(): Promise<OnlineSnapshot | null> {
    if (!EnvConfig.MINECRAFT_RCON_PASSWORD) {
        return null;
    }

    return withRconConnection(async (rcon) => {
        const response = await rcon.send("list");
        const parsed = parsePlayersFromRconListResponse(response);
        if (!parsed) {
            logger.warn(`[Minecraft] Réponse RCON inattendue pour 'list': ${response}`);
            return null;
        }
        return parsed;
    });
}

function schedulePendingRename(client: Client, delayMs: number): void {
    if (pendingRenameTimer) return;

    pendingRenameTimer = setTimeout(() => {
        pendingRenameTimer = null;
        void flushPendingRename(client);
    }, delayMs);
}

async function flushPendingRename(client: Client): Promise<void> {
    if (!pendingName) return;

    const nextName = pendingName;
    pendingName = null;

    const guildChannel = await getTargetGuildChannel(client);
    if (!guildChannel) return;
    if (guildChannel.name === nextName) return;

    const now = Date.now();
    const delay = getRequiredDelayBeforeRename(now);
    if (delay > 0) {
        pendingName = nextName;
        schedulePendingRename(client, delay);
        return;
    }

    await guildChannel.setName(nextName);
    recordRename(Date.now());
    logger.info(`[Minecraft] Salon renommé: ${nextName}`);
}

async function tryRenameMinecraftChannel(client: Client, expectedName: string): Promise<void> {
    const guildChannel = await getTargetGuildChannel(client);
    if (!guildChannel) return;

    if (guildChannel.name === expectedName) return;

    const now = Date.now();
    const delay = getRequiredDelayBeforeRename(now);
    if (delay > 0) {
        pendingName = expectedName;
        schedulePendingRename(client, delay);
        logger.info(`[Minecraft] Rename différé pour respecter la limite Discord (dans ${Math.ceil(delay / 1000)}s)`);
        return;
    }

    await guildChannel.setName(expectedName);
    recordRename(now);
    logger.info(`[Minecraft] Salon renommé: ${expectedName}`);
}

export function startMinecraftOnlineChannelUpdater(client: Client): void {
    if (!chunkyStateInitPromise) {
        chunkyStateInitPromise = loadChunkyStateFromDisk();
    }

    const intervalMs = EnvConfig.MINECRAFT_ONLINE_UPDATE_INTERVAL_MS;

    if (intervalMs <= 0) {
        logger.warn("[Minecraft] Updater désactivé (interval <= 0)");
        return;
    }

    const tick = async () => {
        try {
            await chunkyStateInitPromise;

            let snapshot = await resolveOnlineSnapshotFromRcon().catch((error) => {
                logger.warn("[Minecraft] RCON indisponible, tentative de fallback présence:", error);
                return null;
            });

            if (!snapshot && EnvConfig.MINECRAFT_ONLINE_USE_PRESENCE_FALLBACK) {
                const onlinePlayers = await resolveOnlinePlayersFromSourcePresence(client);
                if (onlinePlayers !== null) {
                    snapshot = {onlinePlayers, players: []};
                }
            }

            if (!snapshot) {
                return;
            }

            await updateMinecraftOnlineChannel(client, snapshot.onlinePlayers);
            await updateMinecraftPlayersTopic(client, snapshot);
            await handleChunkyPauseOnPlayersOnline(snapshot);
            await handleChunkyAutomation(snapshot);
        } catch (error) {
            logger.warn("[Minecraft] Erreur pendant la mise à jour du salon:", error);
        }
    };

    void tick();
    setInterval(() => {
        void tick();
    }, intervalMs);

    logger.info(`[Minecraft] Updater démarré (interval ${intervalMs / 1000}s)`);
}


