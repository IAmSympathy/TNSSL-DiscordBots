/**
 * Nexa - Bot Discord musique YouTube
 * Tourne dans le processus Node de Netricsa via son propre Client Discord (NEXA_TOKEN).
 * Tout passe par Components V2 dans le salon NEXA_MUSIC_CHANNEL_ID.
 */

import {Client, Events, GatewayIntentBits, type Message, MessageFlags, TextChannel,} from "discord.js";
import * as dotenv from "dotenv";
import type {Player, Track} from "lavalink-client";
import {getHistory, getKazagumo, getOrCreatePlayer, initKazagumo, isLavalinkReady, previousTrack, pushHistory, searchTrack, skipTrack, stopPlayback, togglePause,} from "./musicPlayer";
import {buildJukeboxPanel, buildTrackProposal} from "./nexaComponents";

dotenv.config();

// ── Pending tracks par userId (en attente de confirmation)
const pendingTracks = new Map<string, { track: Track; tracks: Track[]; guildId: string; voiceChannelId: string; textChannelId: string }>();

export class NexaBot {
    public client: Client;
    private ready = false;
    private controlMessages = new Map<string, string>(); // guildId → messageId

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers,
            ],
        });
        this.setupEvents();
    }

    public async start(): Promise<void> {
        const token = process.env.NEXA_TOKEN;
        if (!token) {
            console.error("[Nexa] NEXA_TOKEN manquant — bot désactivé");
            return;
        }

        const m = initKazagumo(this.client);

        m.on("trackStart", async (player) => {
            console.log(`[Nexa] ▶️ ${player.queue.current?.info.title}`);
            await this.refreshPanel(player.guildId);
        });
        m.on("trackEnd", async (player, track) => {
            // Push la track qui vient de se terminer dans l'historique
            if (track) pushHistory(player.guildId, track as Track);
            await this.refreshPanel(player.guildId);
        });
        m.on("queueEnd", async (player) => {
            console.log(`[Nexa] 🏁 File vide — ${player.guildId}`);
            await this.refreshPanel(player.guildId);
            // Détruire le player après 5 min d'inactivité
            setTimeout(async () => {
                const p = getKazagumo().getPlayer(player.guildId);
                if (p && !p.playing && !p.queue.tracks.length) {
                    await p.destroy();
                    await this.refreshPanel(player.guildId);
                }
            }, 5 * 60 * 1000);
        });
        m.on("trackError", async (player) => {
            console.error(`[Nexa] ❌ Erreur track — ${player.guildId}`);
            await this.refreshPanel(player.guildId);
        });

        await this.client.login(token);
    }

    public async stop(): Promise<void> {
        await this.client.destroy();
    }

    public isReady(): boolean {
        return this.ready;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PANNEAU DE CONTRÔLE
    // ─────────────────────────────────────────────────────────────────────────

    public async refreshPanel(guildId: string): Promise<void> {
        const channelId = process.env.NEXA_MUSIC_CHANNEL_ID;
        if (!channelId) return;

        const channel = this.client.channels.cache.get(channelId) as TextChannel | undefined;
        if (!channel) return;

        let player: Player | undefined;
        try {
            player = getKazagumo().getPlayer(guildId);
        } catch { /* manager pas encore prêt */
        }

        const hasHistory = getHistory(guildId).length > 0;
        const options = await buildJukeboxPanel(player ?? null, hasHistory);

        // Essaie d'éditer le message existant
        const existingId = this.controlMessages.get(guildId);
        if (existingId) {
            const existing = await channel.messages.fetch(existingId).catch(() => null);
            if (existing) {
                await existing.edit(options as any).catch(() => null);
                return;
            }
        }

        // Sinon, nettoie et recrée
        try {
            const msgs = await channel.messages.fetch({limit: 20}).catch(() => null);
            if (msgs) {
                for (const [, msg] of msgs.filter(m => m.author.id === this.client.user!.id)) {
                    await msg.delete().catch(() => {
                    });
                }
            }
            const newMsg = await channel.send(options as any);
            this.controlMessages.set(guildId, newMsg.id);
        } catch (err) {
            console.error("[Nexa] Erreur panneau:", err);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    private setupEvents(): void {
        // Forward raw events vers lavalink-client
        this.client.on("raw", (d) => {
            try {
                getKazagumo().sendRawData(d);
            } catch { /* pas encore init */
            }
        });

        this.client.once(Events.ClientReady, async (c) => {
            console.log(`[Nexa] ✅ Connecté : ${c.user.tag}`);
            this.ready = true;

            await getKazagumo().init({id: c.user.id, username: c.user.username, shards: "auto"});
            console.log("[Nexa] LavalinkManager initialisé");

            // Restaure le panneau dans tous les guilds
            setTimeout(() => this.restoreAllPanels(), 3000);
        });

        // Message dans le salon dédié → recherche
        this.client.on(Events.MessageCreate, async (message) => {
            if (message.author.bot) return;
            const channelId = process.env.NEXA_MUSIC_CHANNEL_ID;
            if (!channelId || message.channelId !== channelId) return;
            await this.handleSearch(message);
        });

        // Boutons et select menus
        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith("nexa_select_")) {
                await interaction.deferUpdate().catch(() => {
                });
                await this.handleSelectMenu(interaction);
                return;
            }
            if (!interaction.isButton()) return;
            if (!interaction.customId.startsWith("nexa_")) return;
            await interaction.deferUpdate().catch(() => {
            });
            await this.handleButton(interaction);
        });

        // Auto-disconnect si salon vocal vide
        this.client.on(Events.VoiceStateUpdate, async (oldState) => {
            let player: Player | undefined;
            try {
                player = getKazagumo().getPlayer(oldState.guild.id);
            } catch {
                return;
            }
            if (!player) return;

            const vc = oldState.guild.channels.cache.get(player.voiceChannelId ?? "");
            if (!vc?.isVoiceBased()) return;
            if (vc.members.filter(m => !m.user.bot).size > 0) return;

            setTimeout(async () => {
                const vc2 = oldState.guild.channels.cache.get(player!.voiceChannelId ?? "");
                if (!vc2?.isVoiceBased()) return;
                if (vc2.members.filter(m => !m.user.bot).size === 0) {
                    await player!.destroy();
                    await this.refreshPanel(oldState.guild.id);
                }
            }, 5 * 60 * 1000);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECHERCHE
    // ─────────────────────────────────────────────────────────────────────────

    private async handleSearch(message: Message): Promise<void> {
        const query = message.content.trim();
        if (!query) return;
        await message.delete().catch(() => {
        });

        const channelId = process.env.NEXA_MUSIC_CHANNEL_ID!;
        const textChan = message.channel as TextChannel;

        if (!await isLavalinkReady()) {
            const m = await textChan.send({content: "⏳ Lavalink en cours de démarrage... réessaie dans quelques secondes."}).catch(() => null);
            if (m) setTimeout(() => m.delete().catch(() => {
            }), 7000);
            return;
        }

        const member = await message.guild?.members.fetch(message.author.id).catch(() => null);
        const voiceChannel = member?.voice.channel;
        if (!voiceChannel) {
            const m = await textChan.send({content: `❌ <@${message.author.id}> Tu dois être dans un salon vocal !`}).catch(() => null);
            if (m) setTimeout(() => m.delete().catch(() => {
            }), 5000);
            return;
        }

        const loading = await textChan.send({content: `\`Recherche de \"${query}\"...\``}).catch(() => null);
        const result = await searchTrack(query, message.guild!.id, voiceChannel.id, channelId, message.author);
        if (loading) await loading.delete().catch(() => {
        });

        if (!result) {
            const m = await textChan.send({content: `❌ Aucun résultat pour **${query}**`}).catch(() => null);
            if (m) setTimeout(() => m.delete().catch(() => {
            }), 5000);
            return;
        }

        const {track, tracks} = result;
        const userId = message.author.id;

        pendingTracks.set(userId, {
            track,
            tracks,
            guildId: message.guild!.id,
            voiceChannelId: voiceChannel.id,
            textChannelId: channelId,
        });
        setTimeout(() => pendingTracks.delete(userId), 5 * 60 * 1000);

        const proposal = await buildTrackProposal(tracks, userId);
        const proposalMsg = await textChan.send(proposal as any).catch(() => null);
        if (proposalMsg) setTimeout(() => proposalMsg.delete().catch(() => {
        }), 5 * 60 * 1000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /** Vérifie que l'utilisateur est dans le même salon vocal que le bot */
    private async isInSameVoiceChannel(interaction: any): Promise<boolean> {
        const guild = this.client.guilds.cache.get(interaction.guildId);
        if (!guild) return false;
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return false;
        const userVc = member.voice.channelId;
        if (!userVc) return false;
        // Cherche le player pour connaître le salon du bot
        let player: Player | undefined;
        try {
            player = getKazagumo().getPlayer(interaction.guildId);
        } catch {
            return false;
        }
        // Si pas de player actif, accepter (confirmation d'ajout etc.)
        if (!player) return true;
        return player.voiceChannelId === userVc;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BOUTONS
    // ─────────────────────────────────────────────────────────────────────────

    private async handleButton(interaction: any): Promise<void> {
        const id: string = interaction.customId;
        const guildId: string = interaction.guildId;

        // ── Confirmation d'ajout
        if (id.startsWith("nexa_confirm_")) {
            const userId = id.replace("nexa_confirm_", "");
            if (interaction.user.id !== userId) return;
            const pending = pendingTracks.get(userId);
            if (!pending) return;
            pendingTracks.delete(userId);
            await interaction.message.delete().catch(() => {
            });
            await this.addAndPlay(pending.guildId, pending.track, pending.voiceChannelId, pending.textChannelId);
            return;
        }

        if (id.startsWith("nexa_cancel_")) {
            const userId = id.replace("nexa_cancel_", "");
            if (interaction.user.id !== userId) return;
            pendingTracks.delete(userId);
            await interaction.message.delete().catch(() => {
            });
            return;
        }

        // ── Contrôles
        let player: Player | undefined;
        try {
            player = getKazagumo().getPlayer(guildId);
        } catch {
            return;
        }
        if (!player && !["nexa_playpause", "nexa_stop"].includes(id)) return;

        // Vérifier que l'utilisateur est dans le même salon vocal que le bot
        if (!await this.isInSameVoiceChannel(interaction)) {
            await interaction.followUp({content: "❌ Tu dois être dans le même salon vocal que moi !", flags: MessageFlags.Ephemeral}).catch(() => {
            });
            return;
        }

        switch (id) {
            case "nexa_prev":
                if (!player) return;
                await previousTrack(guildId);
                break;

            case "nexa_playpause":
                if (!player) return;
                await togglePause(guildId);
                await this.refreshPanel(guildId);
                break;

            case "nexa_skip":
                await skipTrack(guildId);
                break;

            case "nexa_stop":
                await stopPlayback(guildId);
                await this.refreshPanel(guildId);
                break;

            case "nexa_loop": {
                if (!player) return;
                const cycle = ["off", "track", "queue"] as const;
                const cur = (player.repeatMode ?? "off") as typeof cycle[number];
                await player.setRepeatMode(cycle[(cycle.indexOf(cur) + 1) % cycle.length]);
                await this.refreshPanel(guildId);
                break;
            }

            case "nexa_shuffle": {
                if (!player) return;
                player.queue.shuffle();
                await this.refreshPanel(guildId);
                break;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SELECT MENU (choix alternatif)
    // ─────────────────────────────────────────────────────────────────────────

    private async handleSelectMenu(interaction: any): Promise<void> {
        const userId = interaction.customId.replace("nexa_select_", "");
        if (interaction.user.id !== userId) return;

        const pending = pendingTracks.get(userId);
        if (!pending) return;

        const value: string = interaction.values[0]; // ex: nexa_alt_userId_2
        const parts = value.split("_");
        const idx = parseInt(parts[parts.length - 1], 10); // index 1-based parmi les alternatives
        const selectedTrack = pending.tracks[idx]; // tracks[0] = premier résultat, tracks[1] = alt 1, etc.
        if (!selectedTrack) return;

        // Mettre à jour le pending avec le nouveau track sélectionné
        pending.track = selectedTrack;
        pendingTracks.set(userId, pending);

        // Reconstruire la proposition avec le nouveau premier choix
        const newTracks = [selectedTrack, ...pending.tracks.filter((_, i) => i !== idx)];
        const proposal = await buildTrackProposal(newTracks, userId);

        // Éditer le message de proposition
        await interaction.message.edit(proposal as any).catch(() => {
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AJOUT + LECTURE
    // ─────────────────────────────────────────────────────────────────────────

    private async addAndPlay(guildId: string, track: Track, voiceChannelId: string, textChannelId: string): Promise<void> {
        try {
            const player = await getOrCreatePlayer(guildId, voiceChannelId, textChannelId);
            if (!player.connected) await player.connect();

            if (!player.playing && !player.paused) {
                await player.play({track});
            } else {
                player.queue.add(track);
                const pos = player.queue.tracks.length;
                const chan = this.client.channels.cache.get(textChannelId) as TextChannel | undefined;
                const m = await chan?.send({content: `✅ **${track.info.title}** ajouté en position **#${pos}**`}).catch(() => null);
                if (m) setTimeout(() => m?.delete().catch(() => {
                }), 5000);
                await this.refreshPanel(guildId);
            }
        } catch (err) {
            console.error("[Nexa] Erreur addAndPlay:", err);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESTORE
    // ─────────────────────────────────────────────────────────────────────────

    private async restoreAllPanels(): Promise<void> {
        const channelId = process.env.NEXA_MUSIC_CHANNEL_ID;
        if (!channelId) return;
        const channel = this.client.channels.cache.get(channelId) as TextChannel | undefined;
        if (!channel) {
            setTimeout(() => this.restoreAllPanels(), 3000);
            return;
        }
        await this.refreshPanel(channel.guildId);
        console.log(`[Nexa] Panneau restauré dans #${channel.name}`);
    }
}

let instance: NexaBot | null = null;

export function getNexaBot(): NexaBot {
    if (!instance) instance = new NexaBot();
    return instance;
}

