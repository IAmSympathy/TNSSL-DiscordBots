import {AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus} from "@discordjs/voice";
import {Client, VoiceBasedChannel} from "discord.js";
import * as path from "path";
import * as fs from "fs";
import {logKlodovikVoice} from "../../utils/discordLogger";

/**
 * Service pour gérer les sons vocaux aléatoires de Klodovik
 */
export class KlodovikVoiceService {
    private static instance: KlodovikVoiceService;
    private readonly soundsPath: string;
    private isPlaying: boolean = false;
    private klodovikClient: Client | null = null;

    private constructor() {
        this.soundsPath = path.join(process.cwd(), "assets", "klodovik_sounds");
        this.ensureSoundsDirectory();
    }

    public static getInstance(): KlodovikVoiceService {
        if (!KlodovikVoiceService.instance) {
            KlodovikVoiceService.instance = new KlodovikVoiceService();
        }
        return KlodovikVoiceService.instance;
    }

    /**
     * Enregistre le client Klodovik pour garantir le bon voiceAdapterCreator
     */
    public setClient(client: Client): void {
        this.klodovikClient = client;
    }

    /**
     * Rejoindre un salon vocal et jouer un son aléatoire avec effets
     */
    public async playRandomSound(channel: VoiceBasedChannel): Promise<boolean> {
        if (!this.canJoinChannel(channel)) {
            return false;
        }
        return this._doPlaySound(channel);
    }

    /**
     * Forcer l'apparition de Klodovik dans un salon vocal (bypass des checks habituels)
     * Utilisé par la commande /ahuaah
     */
    public async playRandomSoundForced(channel: VoiceBasedChannel): Promise<boolean> {
        const soundFile = this.getRandomSound();
        if (!soundFile) {
            return false;
        }
        // Détruire une éventuelle connexion existante avant de rejoindre
        const existingConnection = getVoiceConnection(channel.guild.id);
        if (existingConnection) {
            existingConnection.destroy();
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (this.isPlaying) {
            this.isPlaying = false;
        }
        return this._doPlaySound(channel);
    }

    /**
     * Vérifie si le service est prêt (au moins 1 son disponible)
     */
    public isReady(): boolean {
        return this.getAvailableSounds().length > 0;
    }

    /**
     * Obtient le nombre de sons disponibles
     */
    public getSoundsCount(): number {
        return this.getAvailableSounds().length;
    }

    /**
     * Logique interne de connexion au vocal et lecture du son
     */
    private async _doPlaySound(channel: VoiceBasedChannel): Promise<boolean> {
        const soundFile = this.getRandomSound();
        if (!soundFile) {
            return false;
        }

        this.isPlaying = true;
        console.log(`[Klodovik Voice] 🎵 Rejoint ${channel.name} pour jouer: ${soundFile}`);

        try {
            // Récupérer le guild depuis le client Klodovik pour avoir le bon voiceAdapterCreator
            const guild = this.klodovikClient
                ? (this.klodovikClient.guilds.cache.get(channel.guild.id) ?? channel.guild)
                : channel.guild;

            // Rejoindre le salon vocal
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator as any,
            });

            // Logger tous les changements d'état pour diagnostiquer
            connection.on("stateChange", (oldState, newState) => {
                console.log(`[Klodovik Voice] 🔄 État connexion: ${oldState.status} → ${newState.status}`);
            });
            connection.on("error", (err) => {
                console.error(`[Klodovik Voice] ❌ Erreur connexion:`, err);
            });

            // Attendre que la connexion soit prête avant de jouer
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
                console.log(`[Klodovik Voice] ✅ Connexion prête !`);
            } catch (e) {
                console.error(`[Klodovik Voice] ❌ Timeout Ready. État actuel: ${connection.state.status}`);
                connection.destroy();
                this.isPlaying = false;
                return false;
            }

            // Créer le lecteur audio
            const player = createAudioPlayer();

            // Créer la ressource audio
            const audioPath = path.join(this.soundsPath, soundFile);
            const volume = this.getRandomVolume();

            const resource = createAudioResource(audioPath, {
                inlineVolume: true,
            });

            // Définir le volume aléatoire (entre 20% et 60%)
            resource.volume?.setVolume(volume);

            console.log(`[Klodovik Voice] Son: ${soundFile} | Volume: ${Math.round(volume * 100)}%`);

            // Log Discord
            await logKlodovikVoice(channel.name, soundFile, volume);

            // Jouer le son
            player.play(resource);
            connection.subscribe(player);

            // Quitter automatiquement après la fin du son
            player.on(AudioPlayerStatus.Idle, () => {
                console.log("[Klodovik Voice] Son terminé, déconnexion...");
                connection.destroy();
                this.isPlaying = false;
            });

            player.on("error", (error) => {
                console.error("[Klodovik Voice] Erreur du lecteur audio:", error);
                connection.destroy();
                this.isPlaying = false;
            });

            // Timeout de sécurité (30 secondes max)
            setTimeout(() => {
                if (connection.state.status !== "destroyed") {
                    console.log("[Klodovik Voice] Timeout, déconnexion forcée");
                    connection.destroy();
                    this.isPlaying = false;
                }
            }, 30000);

            return true;
        } catch (error) {
            console.error("[Klodovik Voice] Erreur lors de la lecture du son:", error);
            this.isPlaying = false;
            return false;
        }
    }

    /**
     * Crée le dossier des sons s'il n'existe pas
     */
    private ensureSoundsDirectory(): void {
        if (!fs.existsSync(this.soundsPath)) {
            fs.mkdirSync(this.soundsPath, {recursive: true});
            console.log(`[Klodovik Voice] Dossier créé: ${this.soundsPath}`);
            console.log("[Klodovik Voice] ⚠️ Ajoutez des fichiers audio (.mp3, .wav, .ogg) dans assets/klodovik_sounds/");
        }
    }

    /**
     * Récupère tous les fichiers audio disponibles
     */
    private getAvailableSounds(): string[] {
        try {
            const files = fs.readdirSync(this.soundsPath);
            return files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return [".mp3", ".wav", ".ogg", ".webm"].includes(ext);
            });
        } catch (error) {
            console.error("[Klodovik Voice] Erreur lors de la lecture des sons:", error);
            return [];
        }
    }

    /**
     * Sélectionne un son aléatoire
     */
    private getRandomSound(): string | null {
        const sounds = this.getAvailableSounds();
        if (sounds.length === 0) {
            console.warn("[Klodovik Voice] Aucun fichier audio trouvé dans assets/klodovik_sounds/");
            return null;
        }
        return sounds[Math.floor(Math.random() * sounds.length)];
    }

    /**
     * Génère un volume aléatoire
     * Volume entre 50% et 100% pour que ce soit toujours audible mais varié
     */
    private getRandomVolume(): number {
        return 0.2 + Math.random() * 0.4;
    }


    /**
     * Vérifie si Klodovik peut rejoindre ce salon
     */
    private canJoinChannel(channel: VoiceBasedChannel): boolean {
        // Vérifier qu'il y a au moins 1 personne (autre que des bots)
        const members = channel.members.filter(m => !m.user.bot);
        if (members.size === 0) return false;

        // Vérifier qu'on n'est pas déjà en train de jouer
        if (this.isPlaying) return false;

        // Vérifier qu'il n'y a pas déjà une connexion vocale
        const existingConnection = getVoiceConnection(channel.guild.id);
        if (existingConnection) return false;

        return true;
    }
}






