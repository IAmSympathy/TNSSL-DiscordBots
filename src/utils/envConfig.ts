import {createLogger} from "./logger";

const logger = createLogger("EnvConfig");

/**
 * Configuration centralisée des variables d'environnement
 * Toutes les variables d'environnement sont définies et typées ici
 */

export class EnvConfig {
    // Discord Bot Token
    static get DISCORD_BOT_TOKEN(): string {
        return process.env.DISCORD_LLM_BOT_TOKEN || "";
    }

    // Discord Channel IDs
    static get WATCH_CHANNEL_ID(): string | undefined {
        return process.env.WATCH_CHANNEL_ID;
    }

    static get WELCOME_CHANNEL_ID(): string | undefined {
        return process.env.WELCOME_CHANNEL_ID;
    }

    static get LOG_CHANNEL_ID(): string | undefined {
        return process.env.LOG_CHANNEL_ID;
    }

    static get NETRICSA_LOG_CHANNEL_ID(): string | undefined {
        return process.env.NETRICSA_LOG_CHANNEL_ID;
    }

    static get FORUM_CHANNEL_ID(): string | undefined {
        return process.env.FORUM_CHANNEL_ID;
    }

    static get CREATION_FORUM_ID(): string | undefined {
        return process.env.CREATION_FORUM_ID;
    }

    static get MEME_CHANNEL_ID(): string | undefined {
        return process.env.MEME_CHANNEL_ID;
    }

    static get ANNOUNCEMENTS_CHANNEL_ID(): string | undefined {
        return process.env.ANNOUNCEMENTS_CHANNEL_ID;
    }

    static get COUNTER_CHANNEL_ID(): string | undefined {
        return process.env.COUNTER_CHANNEL_ID;
    }

    static get COMMAND_CHANNEL_ID(): string | undefined {
        return process.env.COMMAND_CHANNEL_ID;
    }

    static get GAMES_CHANNEL_ID(): string | undefined {
        return process.env.GAMES_CHANNEL_ID;
    }

    static get DAILY_CHALLENGES_CHANNEL_ID(): string | undefined {
        return process.env.DAILY_CHALLENGES_CHANNEL_ID;
    }

    static get FREE_GAMES_CHANNEL_ID(): string | undefined {
        return process.env.FREE_GAMES_CHANNEL_ID;
    }

    static get CITATIONS_THREAD_ID(): string | undefined {
        return process.env.CITATIONS_THREAD_ID;
    }

    // Guild/Server ID
    static get GUILD_ID(): string | undefined {
        return process.env.GUILD_ID;
    }

    // Role IDs
    static get BIRTHDAY_ROLE_ID(): string | undefined {
        return process.env.BIRTHDAY_ROLE_ID;
    }

    static get ROLE_REACTION_MESSAGE_ID(): string | undefined {
        return process.env.ROLE_REACTION_MESSAGE_ID;
    }

    static get ROLE_REACTION_ROLE_ID(): string | undefined {
        return process.env.ROLE_REACTION_ROLE_ID;
    }

    static get FREE_GAMES_LOOT_ROLE_ID(): string | undefined {
        return process.env.FREE_GAMES_LOOT_ROLE_ID;
    }

    static get FREE_GAMES_LOOT_EMOJI_ID(): string | undefined {
        return process.env.FREE_GAMES_LOOT_EMOJI_ID;
    }

    static get ROLE_REACTION_EMOJI_ID(): string | undefined {
        return process.env.ROLE_REACTION_EMOJI_ID;
    }

    static get ROLE_REACTION_CHANNEL_ID(): string | undefined {
        return process.env.ROLE_REACTION_CHANNEL_ID;
    }

    // File Paths
    static get SYSTEM_PROMPT_PATH(): string {
        return process.env.SYSTEM_PROMPT_PATH || "./data/system_prompt.txt";
    }

    static get SERVER_PROMPT_PATH(): string {
        // Gardé pour backup, non utilisé dans le code
        return process.env.SERVER_PROMPT_PATH || "./data/server_prompt.txt";
    }

    static get SYSTEM_PROMPT_VISION_PATH(): string {
        return process.env.SYSTEM_PROMPT_VISION_PATH || "./data/system_prompt_vision.txt";
    }

    static get MEMORY_FILE_PATH(): string {
        return process.env.MEMORY_FILE || "./data/memory.json";
    }

    // Ollama Configuration
    static get OLLAMA_TEXT_MODEL(): string {
        return process.env.OLLAMA_TEXT_MODEL || "llama3.1:8b-instruct-q8_0";
    }

    static get OLLAMA_VISION_MODEL(): string {
        return process.env.OLLAMA_VISION_MODEL || "qwen2.5-vl:7b";
    }

    // Memory Configuration
    static get MEMORY_MAX_TURNS(): number {
        return parseInt(process.env.MEMORY_MAX_TURNS || "50", 10);
    }

    // Debug Flags
    static get DEBUG_OLLAMA_RAW(): boolean {
        return process.env.DEBUG_OLLAMA_RAW === "1";
    }

    // API Keys
    static get BRAVE_SEARCH_API_KEY(): string | undefined {
        return process.env.BRAVE_SEARCH_API_KEY;
    }

    static get FREESTUFF_API_KEY(): string | undefined {
        return process.env.FREESTUFF_API_KEY;
    }

    static get FREESTUFF_WEBHOOK_PORT(): number {
        return parseInt(process.env.FREESTUFF_WEBHOOK_PORT || "3000", 10);
    }

    static get WEBHOOK_PUBLIC_URL(): string {
        const port = this.FREESTUFF_WEBHOOK_PORT;
        return process.env.WEBHOOK_PUBLIC_URL || `http://localhost:${port}`;
    }

    // ── Nexa (bot de musique)
    static get NEXA_TOKEN(): string | undefined {
        return process.env.NEXA_TOKEN;
    }

    static get NEXA_CLIENT_ID(): string | undefined {
        return process.env.NEXA_CLIENT_ID;
    }

    /** ID du salon dédié musique (texte + requêtes) */
    static get NEXA_MUSIC_CHANNEL_ID(): string | undefined {
        return process.env.NEXA_MUSIC_CHANNEL_ID;
    }

    /** Cookie YouTube optionnel pour contourner les restrictions anti-bot */
    static get YOUTUBE_COOKIE(): string | undefined {
        return process.env.YOUTUBE_COOKIE;
    }

    // Meme Subreddits
    static get MEME_SUBREDDITS(): string[] {
        const subreddits = process.env.MEME_SUBREDDITS || "shitposting";
        return subreddits.split(',').map(s => s.trim());
    }

    /**
     * Valide que toutes les variables d'environnement requises sont présentes
     */
    static validate(): { valid: boolean; missing: string[] } {
        const missing: string[] = [];

        if (!this.DISCORD_BOT_TOKEN) missing.push("DISCORD_LLM_BOT_TOKEN");
        if (!this.SYSTEM_PROMPT_PATH) missing.push("SYSTEM_PROMPT_PATH");
        // SERVER_PROMPT_PATH retiré - non utilisé (gardé en backup seulement)

        return {
            valid: missing.length === 0,
            missing
        };
    }

    /**
     * Affiche un résumé de la configuration
     */
    static printSummary(): void {
        logger.info("=== Configuration Environment ===");
        logger.info(`Watch Channel: ${this.WATCH_CHANNEL_ID || "Not configured"}`);
        logger.info(`Welcome Channel: ${this.WELCOME_CHANNEL_ID || "Not configured"}`);
        logger.info(`Log Channel: ${this.LOG_CHANNEL_ID || "Not configured"}`);
        logger.info(`Forum Channel: ${this.FORUM_CHANNEL_ID || "Not configured"}`);
        logger.info(`Meme Channel: ${this.MEME_CHANNEL_ID || "Not configured"}`);
        logger.info(`Guild ID: ${this.GUILD_ID || "Not configured"}`);
        logger.info(`Birthday Role: ${this.BIRTHDAY_ROLE_ID || "Not configured"}`);
        logger.info(`Ollama Text Model: ${this.OLLAMA_TEXT_MODEL}`);
        logger.info(`Ollama Vision Model: ${this.OLLAMA_VISION_MODEL}`);
        logger.info(`Memory Max Turns: ${this.MEMORY_MAX_TURNS}`);
        logger.info(`Meme Subreddits: ${this.MEME_SUBREDDITS.join(", ")}`);
        logger.info("================================");
    }
}
