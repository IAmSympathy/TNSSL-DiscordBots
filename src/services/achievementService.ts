import * as fs from "fs";
import * as path from "path";
import {createLogger} from "../utils/logger";
import {DATA_DIR} from "../utils/constants";
import {Client, TextChannel} from "discord.js";

const logger = createLogger("AchievementService");
const ACHIEVEMENTS_FILE = path.join(DATA_DIR, "user_achievements.json");

/**
 * Catégories d'achievements
 */
export enum AchievementCategory {
    PROFIL = "profil",
    NETRICSA = "netricsa",
    DISCORD = "discord",
    JEUX = "jeux",
    FUN = "fun"
}

/**
 * Définition d'un achievement
 */
export interface Achievement {
    id: string;
    category: AchievementCategory;
    name: string;
    description: string;
    emoji: string;
    secret: boolean; // Si true, la description n'est pas visible tant que non débloqué
    xpReward: number;
}

/**
 * Progression d'un achievement pour un utilisateur
 */
export interface UserAchievement {
    achievementId: string;
    unlockedAt: number | null; // timestamp ou null si pas débloqué
    notified: boolean; // Si l'utilisateur a été notifié du déblocage
}

/**
 * Base de données des achievements utilisateurs
 */
interface AchievementsDatabase {
    [userId: string]: {
        username: string;
        achievements: UserAchievement[];
        lastUpdate: number;
    };
}

/**
 * Liste de tous les achievements disponibles
 */
export const ALL_ACHIEVEMENTS: Achievement[] = [
    // === ACHIEVEMENTS PROFIL ===
    // Commun : action ponctuelle, passive
    {
        id: "profile_birthday_set",
        category: AchievementCategory.PROFIL,
        name: "Gâteau d'anniversaire",
        description: "Ajouter sa date d'anniversaire à son profil avec notification activée",
        emoji: "🎂",
        secret: false,
        xpReward: 75
    },
    {
        id: "profile_nickname",
        category: AchievementCategory.PROFIL,
        name: "Surnommé",
        description: "Avoir au moins 1 surnom enregistré par Netricsa",
        emoji: "🏷️",
        secret: false,
        xpReward: 75
    },
    {
        id: "profile_facts_3",
        category: AchievementCategory.PROFIL,
        name: "Livre ouvert",
        description: "Avoir 3 faits enregistrés dans son profil par Netricsa",
        emoji: "📚",
        secret: false,
        xpReward: 100
    },
    {
        id: "profile_interests_5",
        category: AchievementCategory.PROFIL,
        name: "Passionné",
        description: "Avoir 5 centres d'intérêt enregistrés par Netricsa",
        emoji: "❤️",
        secret: false,
        xpReward: 150
    },
    // === ACHIEVEMENTS COMPTEUR ===
    // Progression longue → courbe Commun→Légendaire
    {
        id: "counter_10_counts",
        category: AchievementCategory.JEUX,
        name: "Compteur Amateur",
        description: "Faire 10 contributions au compteur",
        emoji: "🎯",
        secret: false,
        xpReward: 50        // Commun
    },
    {
        id: "counter_50_counts",
        category: AchievementCategory.JEUX,
        name: "Compteur Confirmé",
        description: "Faire 50 contributions au compteur",
        emoji: "🏅",
        secret: false,
        xpReward: 150       // Peu commun
    },
    {
        id: "counter_100_counts",
        category: AchievementCategory.JEUX,
        name: "Maître du Compteur",
        description: "Faire 100 contributions au compteur",
        emoji: "👑",
        secret: false,
        xpReward: 300       // Rare
    },
    {
        id: "counter_500_counts",
        category: AchievementCategory.JEUX,
        name: "Légende du Compteur",
        description: "Faire 500 contributions au compteur",
        emoji: "💎",
        secret: false,
        xpReward: 600       // Épique
    },
    {
        id: "counter_1000_counts",
        category: AchievementCategory.JEUX,
        name: "Dieu du Compteur",
        description: "Faire 1000 contributions au compteur",
        emoji: "🌟",
        secret: false,
        xpReward: 1200      // Légendaire
    },

    // === ACHIEVEMENTS JEUX - GÉNÉRAUX ===
    {
        id: "game_first",
        category: AchievementCategory.JEUX,
        name: "Première Partie",
        description: "Jouer sa première partie",
        emoji: "🎲",
        secret: false,
        xpReward: 50        // Commun
    },
    {
        id: "game_played_50",
        category: AchievementCategory.JEUX,
        name: "Joueur Régulier",
        description: "Jouer 50 parties au total",
        emoji: "🎮",
        secret: false,
        xpReward: 150       // Peu commun
    },
    {
        id: "game_played_200",
        category: AchievementCategory.JEUX,
        name: "Accro aux Jeux",
        description: "Jouer 200 parties au total",
        emoji: "🎯",
        secret: false,
        xpReward: 300       // Rare
    },
    {
        id: "game_polyvalent",
        category: AchievementCategory.JEUX,
        name: "Polyvalent",
        description: "Jouer à tous les jeux disponibles",
        emoji: "🌟",
        secret: false,
        xpReward: 200       // Rare (effort de découverte)
    },
    {
        id: "game_first_win",
        category: AchievementCategory.JEUX,
        name: "Premier Sang",
        description: "Gagner sa première partie",
        emoji: "🏆",
        secret: false,
        xpReward: 75        // Commun
    },
    {
        id: "game_win_25",
        category: AchievementCategory.JEUX,
        name: "Champion en Herbe",
        description: "Gagner 25 parties au total",
        emoji: "⭐",
        secret: false,
        xpReward: 150       // Peu commun
    },
    {
        id: "game_win_100",
        category: AchievementCategory.JEUX,
        name: "Maître des Jeux",
        description: "Gagner 100 parties au total",
        emoji: "👑",
        secret: false,
        xpReward: 300       // Rare
    },
    {
        id: "game_win_500",
        category: AchievementCategory.JEUX,
        name: "Légende Vivante",
        description: "Gagner 500 parties au total",
        emoji: "🔥",
        secret: false,
        xpReward: 600       // Épique
    },
    {
        id: "game_streak_3",
        category: AchievementCategory.JEUX,
        name: "Hot Streak",
        description: "Gagner 3 parties d'affilée",
        emoji: "🔥",
        secret: false,
        xpReward: 100       // Peu commun
    },
    {
        id: "game_streak_5",
        category: AchievementCategory.JEUX,
        name: "Unstoppable",
        description: "Gagner 5 parties d'affilée",
        emoji: "⚡",
        secret: false,
        xpReward: 200       // Rare
    },
    {
        id: "game_streak_10",
        category: AchievementCategory.JEUX,
        name: "Domination",
        description: "Gagner 10 parties d'affilée",
        emoji: "🌟",
        secret: false,
        xpReward: 450       // Épique
    },
    {
        id: "game_streak_20",
        category: AchievementCategory.JEUX,
        name: "Perfection",
        description: "Gagner 20 parties d'affilée",
        emoji: "💎",
        secret: false,
        xpReward: 900       // Légendaire (quasi impossible)
    },
    {
        id: "game_loss_10",
        category: AchievementCategory.JEUX,
        name: "Persévérant",
        description: "Perdre 10 parties mais continuer à jouer",
        emoji: "💪",
        secret: false,
        xpReward: 75        // Commun (consolation)
    },
    {
        id: "game_loss_50",
        category: AchievementCategory.JEUX,
        name: "Inébranlable",
        description: "Perdre 50 parties mais continuer à jouer",
        emoji: "🛡️",
        secret: false,
        xpReward: 150       // Peu commun
    },
    {
        id: "game_loss_100",
        category: AchievementCategory.JEUX,
        name: "Titan",
        description: "Perdre 100 parties mais continuer à jouer",
        emoji: "🦾",
        secret: false,
        xpReward: 250       // Rare
    },

    // === ACHIEVEMENTS JEUX - ROCHE-PAPIER-CISEAUX ===
    {
        id: "rps_win_10",
        category: AchievementCategory.JEUX,
        name: "Débutant RPS",
        description: "Gagner 10 parties de Roche-Papier-Ciseaux",
        emoji: "✊",
        secret: false,
        xpReward: 75
    },
    {
        id: "rps_win_50",
        category: AchievementCategory.JEUX,
        name: "Amateur RPS",
        description: "Gagner 50 parties de Roche-Papier-Ciseaux",
        emoji: "🪨",
        secret: false,
        xpReward: 150
    },
    {
        id: "rps_win_200",
        category: AchievementCategory.JEUX,
        name: "Expert RPS",
        description: "Gagner 200 parties de Roche-Papier-Ciseaux",
        emoji: "📜",
        secret: false,
        xpReward: 350
    },
    {
        id: "rps_pvp_25",
        category: AchievementCategory.JEUX,
        name: "Duelliste RPS",
        description: "Gagner 25 parties de RPS contre des joueurs",
        emoji: "⚔️",
        secret: false,
        xpReward: 200       // PvP vaut plus que PvE à même seuil
    },
    {
        id: "rps_pvp_100",
        category: AchievementCategory.JEUX,
        name: "Maître du Duel RPS",
        description: "Gagner 100 parties de RPS contre des joueurs",
        emoji: "👊",
        secret: false,
        xpReward: 500
    },
    {
        id: "rps_pve_50",
        category: AchievementCategory.JEUX,
        name: "Entraîneur RPS",
        description: "Gagner 50 parties de RPS contre Netricsa",
        emoji: "🤖",
        secret: false,
        xpReward: 100
    },
    {
        id: "rps_pve_200",
        category: AchievementCategory.JEUX,
        name: "Destructeur de Bot RPS",
        description: "Gagner 200 parties de RPS contre Netricsa",
        emoji: "🎯",
        secret: false,
        xpReward: 250
    },
    {
        id: "rps_triple",
        category: AchievementCategory.JEUX,
        name: "Triple Menace",
        description: "Gagner avec chaque choix (Roche, Papier, Ciseaux)",
        emoji: "✊📜✂️",
        secret: false,
        xpReward: 75
    },
    {
        id: "rps_only_rock",
        category: AchievementCategory.JEUX,
        name: "Têtu comme une Roche",
        description: "Gagner 10 parties en ne jouant QUE Roche",
        emoji: "🪨",
        secret: true,
        xpReward: 250       // Secret → au moins Rare
    },
    {
        id: "rps_only_paper",
        category: AchievementCategory.JEUX,
        name: "L'Écrivain",
        description: "Gagner 10 parties en ne jouant QUE Papier",
        emoji: "📜",
        secret: true,
        xpReward: 250
    },
    {
        id: "rps_only_scissors",
        category: AchievementCategory.JEUX,
        name: "Le Coiffeur",
        description: "Gagner 10 parties en ne jouant QUE Ciseaux",
        emoji: "✂️",
        secret: true,
        xpReward: 250
    },
    {
        id: "rps_streak_5",
        category: AchievementCategory.JEUX,
        name: "Prédicateur",
        description: "Gagner 5 parties d'affilée en RPS",
        emoji: "🔮",
        secret: false,
        xpReward: 150
    },

    // === ACHIEVEMENTS JEUX - TIC-TAC-TOE ===
    {
        id: "ttt_win_10",
        category: AchievementCategory.JEUX,
        name: "Débutant TTT",
        description: "Gagner 10 parties de Tic-Tac-Toe",
        emoji: "⭕",
        secret: false,
        xpReward: 75
    },
    {
        id: "ttt_win_50",
        category: AchievementCategory.JEUX,
        name: "Amateur TTT",
        description: "Gagner 50 parties de Tic-Tac-Toe",
        emoji: "❌",
        secret: false,
        xpReward: 150
    },
    {
        id: "ttt_win_200",
        category: AchievementCategory.JEUX,
        name: "Expert TTT",
        description: "Gagner 200 parties de Tic-Tac-Toe",
        emoji: "🎯",
        secret: false,
        xpReward: 350
    },
    {
        id: "ttt_pvp_25",
        category: AchievementCategory.JEUX,
        name: "Stratège TTT",
        description: "Gagner 25 parties de TTT contre des joueurs",
        emoji: "🤝",
        secret: false,
        xpReward: 200
    },
    {
        id: "ttt_pvp_100",
        category: AchievementCategory.JEUX,
        name: "Grand Maître TTT",
        description: "Gagner 100 parties de TTT contre des joueurs",
        emoji: "🧠",
        secret: false,
        xpReward: 500
    },
    {
        id: "ttt_pve_50",
        category: AchievementCategory.JEUX,
        name: "Élève Studieux",
        description: "Gagner 50 parties de TTT contre Netricsa",
        emoji: "🤖",
        secret: false,
        xpReward: 100
    },
    {
        id: "ttt_pve_200",
        category: AchievementCategory.JEUX,
        name: "Diplômé TTT",
        description: "Gagner 200 parties de TTT contre Netricsa",
        emoji: "🎓",
        secret: false,
        xpReward: 250
    },
    {
        id: "ttt_draw_20",
        category: AchievementCategory.JEUX,
        name: "Le Mur",
        description: "Faire 20 égalités en TTT",
        emoji: "🧱",
        secret: false,
        xpReward: 100
    },

    // === ACHIEVEMENTS JEUX - CONNECT 4 ===
    // C4 est plus stratégique → légèrement plus valorisé que RPS/TTT
    {
        id: "c4_win_10",
        category: AchievementCategory.JEUX,
        name: "Débutant C4",
        description: "Gagner 10 parties de Connect 4",
        emoji: "🟡",
        secret: false,
        xpReward: 100
    },
    {
        id: "c4_win_50",
        category: AchievementCategory.JEUX,
        name: "Amateur C4",
        description: "Gagner 50 parties de Connect 4",
        emoji: "🔴",
        secret: false,
        xpReward: 200
    },
    {
        id: "c4_win_200",
        category: AchievementCategory.JEUX,
        name: "Expert C4",
        description: "Gagner 200 parties de Connect 4",
        emoji: "⚫",
        secret: false,
        xpReward: 450
    },
    {
        id: "c4_pvp_25",
        category: AchievementCategory.JEUX,
        name: "Tacticien C4",
        description: "Gagner 25 parties de C4 contre des joueurs",
        emoji: "🎯",
        secret: false,
        xpReward: 250
    },
    {
        id: "c4_pvp_100",
        category: AchievementCategory.JEUX,
        name: "Génie C4",
        description: "Gagner 100 parties de C4 contre des joueurs",
        emoji: "🧠",
        secret: false,
        xpReward: 600
    },
    {
        id: "c4_pve_50",
        category: AchievementCategory.JEUX,
        name: "Calculateur",
        description: "Gagner 50 parties de C4 contre Netricsa",
        emoji: "🤖",
        secret: false,
        xpReward: 150
    },
    {
        id: "c4_pve_200",
        category: AchievementCategory.JEUX,
        name: "Maître Algorithmique",
        description: "Gagner 200 parties de C4 contre Netricsa",
        emoji: "🎓",
        secret: false,
        xpReward: 350
    },

    // === ACHIEVEMENTS JEUX - PENDU ===
    {
        id: "hangman_win_10",
        category: AchievementCategory.JEUX,
        name: "Débutant Pendu",
        description: "Gagner 10 parties de Pendu",
        emoji: "📝",
        secret: false,
        xpReward: 75
    },
    {
        id: "hangman_win_50",
        category: AchievementCategory.JEUX,
        name: "Amateur Pendu",
        description: "Gagner 50 parties de Pendu",
        emoji: "📚",
        secret: false,
        xpReward: 150
    },
    {
        id: "hangman_win_200",
        category: AchievementCategory.JEUX,
        name: "Expert Pendu",
        description: "Gagner 200 parties de Pendu",
        emoji: "🎓",
        secret: false,
        xpReward: 350
    },
    {
        id: "hangman_perfect",
        category: AchievementCategory.JEUX,
        name: "Sans Faute",
        description: "Gagner une partie sans aucune erreur",
        emoji: "🎯",
        secret: false,
        xpReward: 150
    },
    {
        id: "hangman_perfect_10",
        category: AchievementCategory.JEUX,
        name: "Perfection Absolue",
        description: "Gagner 10 parties sans aucune erreur",
        emoji: "💎",
        secret: false,
        xpReward: 500       // Épique – très difficile
    },
    {
        id: "hangman_streak_5",
        category: AchievementCategory.JEUX,
        name: "Série Parfaite",
        description: "Gagner 5 parties de Pendu d'affilée",
        emoji: "🏆",
        secret: false,
        xpReward: 200
    },

    // === ACHIEVEMENTS JEUX - BLACKJACK ===
    {
        id: "blackjack_first",
        category: AchievementCategory.JEUX,
        name: "Première Main",
        description: "Jouer sa première partie de Blackjack",
        emoji: "🃏",
        secret: false,
        xpReward: 50
    },
    {
        id: "blackjack_win_10",
        category: AchievementCategory.JEUX,
        name: "Compteur de Cartes",
        description: "Gagner 10 parties de Blackjack",
        emoji: "🎰",
        secret: false,
        xpReward: 100
    },
    {
        id: "blackjack_win_50",
        category: AchievementCategory.JEUX,
        name: "Pro du Blackjack",
        description: "Gagner 50 parties de Blackjack",
        emoji: "🏆",
        secret: false,
        xpReward: 200
    },
    {
        id: "blackjack_streak_5",
        category: AchievementCategory.JEUX,
        name: "Série Chanceuse",
        description: "Gagner 5 parties de Blackjack d'affilée",
        emoji: "🔥",
        secret: false,
        xpReward: 200
    },
    {
        id: "blackjack_natural",
        category: AchievementCategory.JEUX,
        name: "Blackjack Naturel",
        description: "Obtenir un Blackjack (21 avec 2 cartes)",
        emoji: "💎",
        secret: false,
        xpReward: 150
    },
    {
        id: "blackjack_21_perfect",
        category: AchievementCategory.JEUX,
        name: "Perfection",
        description: "Atteindre 21 avec 5 cartes ou plus",
        emoji: "✨",
        secret: true,
        xpReward: 400       // Épique – très rare et secret
    },

    // === ACHIEVEMENTS JEUX - SECRETS & FUN ===
    {
        id: "game_easy",
        category: AchievementCategory.JEUX,
        name: "Trop Facile",
        description: "Gagner 10 parties contre Netricsa sans perdre",
        emoji: "😎",
        secret: true,
        xpReward: 300
    },
    {
        id: "game_beat_netricsa_100",
        category: AchievementCategory.JEUX,
        name: "Je Suis Ton Père",
        description: "Battre Netricsa 100 fois au total",
        emoji: "🤖",
        secret: true,
        xpReward: 500
    },
    {
        id: "game_all_today",
        category: AchievementCategory.JEUX,
        name: "Touche-à-Tout",
        description: "Jouer à tous les jeux dans la même journée",
        emoji: "🔄",
        secret: false,
        xpReward: 150
    },
    {
        id: "game_night_owl",
        category: AchievementCategory.JEUX,
        name: "Insomniac Gamer",
        description: "Jouer entre 2h et 5h du matin",
        emoji: "🌙",
        secret: true,
        xpReward: 200
    },
    {
        id: "game_marathon",
        category: AchievementCategory.JEUX,
        name: "Marathonien",
        description: "Jouer 20 parties en une seule session",
        emoji: "⏰",
        secret: false,
        xpReward: 200
    },
    {
        id: "game_bad_day",
        category: AchievementCategory.JEUX,
        name: "C'est Pas Mon Jour",
        description: "Perdre 10 parties d'affilée",
        emoji: "💀",
        secret: true,
        xpReward: 100       // Secret de consolation
    },
    {
        id: "game_first_10_loss",
        category: AchievementCategory.JEUX,
        name: "L'Apprentissage",
        description: "Perdre ses 10 premières parties",
        emoji: "😅",
        secret: true,
        xpReward: 100
    },

    // === ACHIEVEMENTS NETRICSA - GÉNÉRATION D'IMAGES ===
    {
        id: "netricsa_gen_first",
        category: AchievementCategory.NETRICSA,
        name: "Première Création",
        description: "Imaginer sa première image avec Netricsa",
        emoji: "🖼️",
        secret: false,
        xpReward: 50
    },
    {
        id: "netricsa_gen_10",
        category: AchievementCategory.NETRICSA,
        name: "Créateur Amateur",
        description: "Imaginer 10 images avec Netricsa",
        emoji: "🎨",
        secret: false,
        xpReward: 100
    },
    {
        id: "netricsa_gen_50",
        category: AchievementCategory.NETRICSA,
        name: "Artiste Confirmé",
        description: "Imaginer 50 images avec Netricsa",
        emoji: "🖌️",
        secret: false,
        xpReward: 250
    },
    {
        id: "netricsa_gen_200",
        category: AchievementCategory.NETRICSA,
        name: "Maître Artiste",
        description: "Imaginer 200 images avec Netricsa",
        emoji: "🌟",
        secret: false,
        xpReward: 500
    },
    {
        id: "netricsa_gen_500",
        category: AchievementCategory.NETRICSA,
        name: "Légende de l'Art",
        description: "Imaginer 500 images avec Netricsa",
        emoji: "🎭",
        secret: false,
        xpReward: 1000      // Légendaire
    },
    // === ACHIEVEMENTS NETRICSA - RÉIMAGINATION ===
    {
        id: "netricsa_reimagine_first",
        category: AchievementCategory.NETRICSA,
        name: "Première Transformation",
        description: "Réimaginer sa première image",
        emoji: "🔄",
        secret: false,
        xpReward: 50
    },
    {
        id: "netricsa_reimagine_10",
        category: AchievementCategory.NETRICSA,
        name: "Réimaginateur Amateur",
        description: "Réimaginer 10 images",
        emoji: "✨",
        secret: false,
        xpReward: 100
    },
    {
        id: "netricsa_reimagine_50",
        category: AchievementCategory.NETRICSA,
        name: "Réimaginateur Confirmé",
        description: "Réimaginer 50 images",
        emoji: "🎪",
        secret: false,
        xpReward: 250
    },
    {
        id: "netricsa_reimagine_200",
        category: AchievementCategory.NETRICSA,
        name: "Maître Réimaginateur",
        description: "Réimaginer 200 images",
        emoji: "🌈",
        secret: false,
        xpReward: 500
    },
    // === ACHIEVEMENTS NETRICSA - UPSCALING ===
    {
        id: "netricsa_upscale_first",
        category: AchievementCategory.NETRICSA,
        name: "Première Amélioration",
        description: "Upscaler sa première image",
        emoji: "🔍",
        secret: false,
        xpReward: 50
    },
    {
        id: "netricsa_upscale_10",
        category: AchievementCategory.NETRICSA,
        name: "HD Amateur",
        description: "Upscaler 10 images",
        emoji: "📸",
        secret: false,
        xpReward: 100
    },
    {
        id: "netricsa_upscale_50",
        category: AchievementCategory.NETRICSA,
        name: "HD Master",
        description: "Upscaler 50 images",
        emoji: "🎬",
        secret: false,
        xpReward: 250
    },
    {
        id: "netricsa_upscale_200",
        category: AchievementCategory.NETRICSA,
        name: "4K Legend",
        description: "Upscaler 200 images",
        emoji: "💎",
        secret: false,
        xpReward: 500
    },
    // === ACHIEVEMENTS NETRICSA - CONVERSATIONS IA ===
    {
        id: "netricsa_conv_5",
        category: AchievementCategory.NETRICSA,
        name: "Première Conversation",
        description: "Converser 5 fois avec Netricsa",
        emoji: "💭",
        secret: false,
        xpReward: 50
    },
    {
        id: "netricsa_conv_50",
        category: AchievementCategory.NETRICSA,
        name: "Bavard IA",
        description: "Converser 50 fois avec Netricsa",
        emoji: "🗣️",
        secret: false,
        xpReward: 150
    },
    {
        id: "netricsa_conv_200",
        category: AchievementCategory.NETRICSA,
        name: "Causeur Expert",
        description: "Converser 200 fois avec Netricsa",
        emoji: "💬",
        secret: false,
        xpReward: 300
    },
    {
        id: "netricsa_conv_500",
        category: AchievementCategory.NETRICSA,
        name: "Meilleur Ami de Netricsa",
        description: "Converser 500 fois avec Netricsa",
        emoji: "🎙️",
        secret: false,
        xpReward: 600
    },
    // === ACHIEVEMENTS NETRICSA - PROMPTS ===
    {
        id: "netricsa_prompt_first",
        category: AchievementCategory.NETRICSA,
        name: "Premier Prompt",
        description: "Créer son premier prompt personnalisé",
        emoji: "✍️",
        secret: false,
        xpReward: 50
    },
    {
        id: "netricsa_prompt_5",
        category: AchievementCategory.NETRICSA,
        name: "Prompt Amateur",
        description: "Créer 5 prompts personnalisés",
        emoji: "📋",
        secret: false,
        xpReward: 100
    },
    {
        id: "netricsa_prompt_20",
        category: AchievementCategory.NETRICSA,
        name: "Maître du Prompt",
        description: "Créer 20 prompts personnalisés",
        emoji: "📝",
        secret: false,
        xpReward: 250
    },
    {
        id: "netricsa_prompt_50",
        category: AchievementCategory.NETRICSA,
        name: "Architecte de Prompts",
        description: "Créer 50 prompts personnalisés",
        emoji: "🎯",
        secret: false,
        xpReward: 500
    },
    // === ACHIEVEMENTS FUN - MEMES ===
    {
        id: "fun_meme_first",
        category: AchievementCategory.FUN,
        name: "Premier Meme",
        description: "Rechercher son premier meme avec /findmeme",
        emoji: "😂",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_meme_10",
        category: AchievementCategory.FUN,
        name: "Chercheur de Memes",
        description: "Rechercher 10 memes avec /findmeme",
        emoji: "🤣",
        secret: false,
        xpReward: 100
    },
    {
        id: "fun_meme_50",
        category: AchievementCategory.FUN,
        name: "Collectionneur de Memes",
        description: "Rechercher 50 memes avec /findmeme",
        emoji: "🎪",
        secret: false,
        xpReward: 200
    },
    {
        id: "fun_meme_200",
        category: AchievementCategory.FUN,
        name: "Roi des Memes",
        description: "Rechercher 200 memes avec /findmeme",
        emoji: "🎭",
        secret: false,
        xpReward: 400
    },
    // === ACHIEVEMENTS FUN - SLOTS ===
    {
        id: "fun_slots_first",
        category: AchievementCategory.FUN,
        name: "Premier Jackpot",
        description: "Jouer aux slots pour la première fois",
        emoji: "🎰",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_slots_25",
        category: AchievementCategory.FUN,
        name: "Joueur de Casino",
        description: "Jouer 25 fois aux slots",
        emoji: "🎲",
        secret: false,
        xpReward: 100
    },
    {
        id: "fun_slots_100",
        category: AchievementCategory.FUN,
        name: "Accro aux Slots",
        description: "Jouer 100 fois aux slots",
        emoji: "💰",
        secret: false,
        xpReward: 250
    },
    {
        id: "fun_slots_777",
        category: AchievementCategory.FUN,
        name: "Chance Légendaire",
        description: "Obtenir 7️⃣7️⃣7️⃣ aux slots",
        emoji: "💎",
        secret: true,
        xpReward: 1200      // Légendaire – probabilité très faible
    },
    // === ACHIEVEMENTS FUN - SHIP ===
    {
        id: "fun_ship_first",
        category: AchievementCategory.FUN,
        name: "Cupidon Amateur",
        description: "Tester la compatibilité pour la première fois",
        emoji: "💘",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_ship_25",
        category: AchievementCategory.FUN,
        name: "Entremetteur",
        description: "Faire 25 tests de compatibilité",
        emoji: "💕",
        secret: false,
        xpReward: 100
    },
    {
        id: "fun_ship_100",
        category: AchievementCategory.FUN,
        name: "Maître de l'Amour",
        description: "Faire 100 tests de compatibilité",
        emoji: "💖",
        secret: false,
        xpReward: 200
    },
    {
        id: "fun_ship_perfect",
        category: AchievementCategory.FUN,
        name: "Match Parfait",
        description: "Obtenir 100% de compatibilité",
        emoji: "💗",
        secret: true,
        xpReward: 350       // Épique – aléatoire
    },
    {
        id: "fun_ship_disaster",
        category: AchievementCategory.FUN,
        name: "Incompatibilité Totale",
        description: "Obtenir 0% de compatibilité",
        emoji: "💔",
        secret: true,
        xpReward: 350
    },
    // === ACHIEVEMENTS FUN - DICE ===
    {
        id: "fun_dice_first",
        category: AchievementCategory.FUN,
        name: "Lanceur de Dés",
        description: "Lancer un dé pour la première fois",
        emoji: "🎲",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_dice_50",
        category: AchievementCategory.FUN,
        name: "Maître du Hasard",
        description: "Lancer 50 dés",
        emoji: "🎯",
        secret: false,
        xpReward: 150
    },
    {
        id: "fun_dice_d20_20",
        category: AchievementCategory.FUN,
        name: "Critique Naturel",
        description: "Obtenir 20 sur un D20",
        emoji: "⭐",
        secret: true,
        xpReward: 350       // Épique – 1/20, secret
    },
    {
        id: "fun_dice_d100_100",
        category: AchievementCategory.FUN,
        name: "Perfection Absolue",
        description: "Obtenir 100 sur un D100",
        emoji: "💯",
        secret: true,
        xpReward: 900       // Légendaire – 1/100, secret
    },
    // === ACHIEVEMENTS FUN - COINFLIP ===
    {
        id: "fun_coinflip_first",
        category: AchievementCategory.FUN,
        name: "Lanceur de Pièce",
        description: "Lancer une pièce pour la première fois",
        emoji: "🪙",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_coinflip_25",
        category: AchievementCategory.FUN,
        name: "Face ou Pile Pro",
        description: "Lancer 25 pièces",
        emoji: "💿",
        secret: false,
        xpReward: 100
    },
    {
        id: "fun_coinflip_edge",
        category: AchievementCategory.FUN,
        name: "Sur la Tranche !",
        description: "Faire tomber la pièce sur la tranche (0.1% de chance)",
        emoji: "⚡",
        secret: true,
        xpReward: 2000      // Légendaire absolu – quasi impossible
    },
    // === ACHIEVEMENTS FUN - CRYSTALBALL ===
    {
        id: "fun_crystalball_first",
        category: AchievementCategory.FUN,
        name: "Voyant Débutant",
        description: "Consulter la boule de cristal pour la première fois",
        emoji: "🔮",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_crystalball_50",
        category: AchievementCategory.FUN,
        name: "Médium Confirmé",
        description: "Poser 50 questions à la boule de cristal",
        emoji: "🌟",
        secret: false,
        xpReward: 150
    },
    {
        id: "fun_crystalball_200",
        category: AchievementCategory.FUN,
        name: "Oracle",
        description: "Poser 200 questions à la boule de cristal",
        emoji: "✨",
        secret: false,
        xpReward: 350
    },
    // === ACHIEVEMENTS FUN - CHOOSE ===
    {
        id: "fun_choose_first",
        category: AchievementCategory.FUN,
        name: "Premier Choix",
        description: "Utiliser /choose pour la première fois",
        emoji: "🎯",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_choose_50",
        category: AchievementCategory.FUN,
        name: "Indécis Chronique",
        description: "Utiliser /choose 50 fois",
        emoji: "🤔",
        secret: false,
        xpReward: 150
    },
    {
        id: "fun_choose_200",
        category: AchievementCategory.FUN,
        name: "Délégateur de Décisions",
        description: "Utiliser /choose 200 fois",
        emoji: "🎲",
        secret: false,
        xpReward: 300
    },
    // === ACHIEVEMENTS FUN - ASCII ===
    {
        id: "fun_ascii_first",
        category: AchievementCategory.FUN,
        name: "Artiste ASCII",
        description: "Créer sa première œuvre ASCII",
        emoji: "🔤",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_ascii_25",
        category: AchievementCategory.FUN,
        name: "Typographe",
        description: "Créer 25 œuvres ASCII",
        emoji: "✍️",
        secret: false,
        xpReward: 150
    },
    {
        id: "fun_ascii_100",
        category: AchievementCategory.FUN,
        name: "Maître ASCII",
        description: "Créer 100 œuvres ASCII",
        emoji: "🎨",
        secret: false,
        xpReward: 300
    },
    // === ACHIEVEMENTS FUN - CUCUMBER ===
    {
        id: "fun_cucumber_first",
        category: AchievementCategory.FUN,
        name: "Première Mesure",
        description: "Mesurer son concombre pour la première fois",
        emoji: "🥒",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_cucumber_25",
        category: AchievementCategory.FUN,
        name: "Scientifique",
        description: "Mesurer son concombre 25 fois... pour la science",
        emoji: "🔬",
        secret: false,
        xpReward: 150
    },
    {
        id: "fun_cucumber_legendary",
        category: AchievementCategory.FUN,
        name: "Concombre Légendaire",
        description: "Obtenir 25cm",
        emoji: "🤯",
        secret: true,
        xpReward: 600       // Épique – très improbable, secret
    },
    {
        id: "fun_cucumber_tiny",
        category: AchievementCategory.FUN,
        name: "Micro Concombre",
        description: "Obtenir 1cm (le minimum)",
        emoji: "🔬",
        secret: true,
        xpReward: 600
    },
    // === ACHIEVEMENTS FUN - QUOTE ===
    {
        id: "fun_quote_first",
        category: AchievementCategory.FUN,
        name: "Premier Mot",
        description: "Créer sa première citation",
        emoji: "💬",
        secret: false,
        xpReward: 50
    },
    {
        id: "fun_quote_10",
        category: AchievementCategory.FUN,
        name: "Chroniqueur",
        description: "Créer 10 citations",
        emoji: "📜",
        secret: false,
        xpReward: 150
    },
    {
        id: "fun_quote_50",
        category: AchievementCategory.FUN,
        name: "Historien",
        description: "Créer 50 citations",
        emoji: "📚",
        secret: false,
        xpReward: 300
    },
    {
        id: "fun_quote_immortaliser",
        category: AchievementCategory.FUN,
        name: "Immortalisé",
        description: "Avoir été cité par quelqu'un d'autre",
        emoji: "🌟",
        secret: true,
        xpReward: 450       // Épique – dépend d'autrui, secret
    },
    // === ACHIEVEMENTS FUN - POLYVALENT ===
    {
        id: "fun_try_all",
        category: AchievementCategory.FUN,
        name: "Touche-à-Tout Fun",
        description: "Essayer toutes les commandes fun au moins une fois",
        emoji: "🎪",
        secret: false,
        xpReward: 300       // Rare – explorer tout
    },
    {
        id: "fun_addict",
        category: AchievementCategory.FUN,
        name: "Accro au Fun",
        description: "Utiliser 500 commandes fun au total",
        emoji: "🎉",
        secret: false,
        xpReward: 600       // Épique
    },
    // === ACHIEVEMENTS NETRICSA - COMBINÉS ===
    {
        id: "netricsa_all_features",
        category: AchievementCategory.NETRICSA,
        name: "Touche-à-tout",
        description: "Utiliser toutes les fonctions images (imaginer, réimaginer, upscaler)",
        emoji: "🎨",
        secret: false,
        xpReward: 200
    },
    {
        id: "netricsa_creator",
        category: AchievementCategory.NETRICSA,
        name: "Créateur Complet",
        description: "Imaginer 100 images et créer 10 prompts",
        emoji: "💎",
        secret: false,
        xpReward: 400
    },
    {
        id: "netricsa_master",
        category: AchievementCategory.NETRICSA,
        name: "Maître Netricsa",
        description: "200 imaginations + 100 conversations + 20 prompts",
        emoji: "🌟",
        secret: false,
        xpReward: 1000      // Légendaire
    },
    {
        id: "netricsa_total_artist",
        category: AchievementCategory.NETRICSA,
        name: "Artiste Total",
        description: "500 imaginations + 200 réimages + 100 upscales",
        emoji: "🎭",
        secret: true,
        xpReward: 2000      // Légendaire absolu
    },
    // === ACHIEVEMENTS DISCORD - MESSAGES ===
    // Vrais membres : ~100-150 msgs réels / 2 semaines → ~2 500-4 000/an
    {
        id: "discord_msg_10",
        category: AchievementCategory.DISCORD,
        name: "Première Parole",
        description: "Envoyer 10 messages sur le serveur",
        emoji: "💬",
        secret: false,
        xpReward: 50        // Commun – quelques heures
    },
    {
        id: "discord_msg_100",
        category: AchievementCategory.DISCORD,
        name: "Bavard",
        description: "Envoyer 100 messages sur le serveur",
        emoji: "🗨️",
        secret: false,
        xpReward: 75        // Commun – ~2 semaines pour les actifs
    },
    {
        id: "discord_msg_500",
        category: AchievementCategory.DISCORD,
        name: "Causeur",
        description: "Envoyer 500 messages sur le serveur",
        emoji: "💭",
        secret: false,
        xpReward: 200       // Rare – ~2-3 mois pour les actifs
    },
    {
        id: "discord_msg_1000",
        category: AchievementCategory.DISCORD,
        name: "Orateur",
        description: "Envoyer 1000 messages sur le serveur",
        emoji: "🗣️",
        secret: false,
        xpReward: 400       // Épique – ~4-6 mois pour les actifs
    },
    {
        id: "discord_msg_5000",
        category: AchievementCategory.DISCORD,
        name: "Porte-Parole",
        description: "Envoyer 5000 messages sur le serveur",
        emoji: "📢",
        secret: false,
        xpReward: 1200      // Légendaire – ~1.5-2 ans, vrai pilier du serveur
    },
    // === ACHIEVEMENTS DISCORD - RÉACTIONS DONNÉES ===
    {
        id: "discord_react_50",
        category: AchievementCategory.DISCORD,
        name: "Réactif",
        description: "Ajouter 50 réactions",
        emoji: "👍",
        secret: false,
        xpReward: 75
    },
    {
        id: "discord_react_200",
        category: AchievementCategory.DISCORD,
        name: "Expressif",
        description: "Ajouter 200 réactions",
        emoji: "😄",
        secret: false,
        xpReward: 200       // Rare – volume notable
    },
    {
        id: "discord_react_500",
        category: AchievementCategory.DISCORD,
        name: "Émotif",
        description: "Ajouter 500 réactions",
        emoji: "🎭",
        secret: false,
        xpReward: 400       // Épique
    },
    // === ACHIEVEMENTS DISCORD - COMMANDES ===
    {
        id: "discord_cmd_10",
        category: AchievementCategory.DISCORD,
        name: "Découvreur",
        description: "Utiliser 10 commandes",
        emoji: "⚡",
        secret: false,
        xpReward: 50
    },
    {
        id: "discord_cmd_50",
        category: AchievementCategory.DISCORD,
        name: "Commandant",
        description: "Utiliser 50 commandes",
        emoji: "🎮",
        secret: false,
        xpReward: 100
    },
    {
        id: "discord_cmd_200",
        category: AchievementCategory.DISCORD,
        name: "Expert des Commandes",
        description: "Utiliser 200 commandes",
        emoji: "🎯",
        secret: false,
        xpReward: 200
    },
    {
        id: "discord_cmd_500",
        category: AchievementCategory.DISCORD,
        name: "Maître des Commandes",
        description: "Utiliser 500 commandes",
        emoji: "🏅",
        secret: false,
        xpReward: 350
    },
    // === ACHIEVEMENTS DISCORD - VOCAL ===
    {
        id: "discord_voice_1h",
        category: AchievementCategory.DISCORD,
        name: "Première Voix",
        description: "Passer 1h en vocal",
        emoji: "🎤",
        secret: false,
        xpReward: 50
    },
    {
        id: "discord_voice_10h",
        category: AchievementCategory.DISCORD,
        name: "Causeur Vocal",
        description: "Passer 10h en vocal",
        emoji: "🎧",
        secret: false,
        xpReward: 150
    },
    {
        id: "discord_voice_50h",
        category: AchievementCategory.DISCORD,
        name: "Habitué du Vocal",
        description: "Passer 50h en vocal",
        emoji: "🎙️",
        secret: false,
        xpReward: 300
    },
    {
        id: "discord_voice_100h",
        category: AchievementCategory.DISCORD,
        name: "Marathonien Vocal",
        description: "Passer 100h en vocal",
        emoji: "📻",
        secret: false,
        xpReward: 500
    },
    {
        id: "discord_voice_500h",
        category: AchievementCategory.DISCORD,
        name: "Légende du Vocal",
        description: "Passer 500h en vocal",
        emoji: "🔊",
        secret: false,
        xpReward: 1000
    },
    {
        id: "discord_voice_1000h",
        category: AchievementCategory.DISCORD,
        name: "Roi du Vocal",
        description: "Passer 1000h en vocal",
        emoji: "📡",
        secret: false,
        xpReward: 2000      // Légendaire absolu – 1000h c'est énorme
    },
    // === ACHIEVEMENTS DISCORD - EMOJIS ===
    // Vrais membres : ~50-60 emojis / 2 semaines → ~1 200-1 500/an
    {
        id: "discord_emoji_100",
        category: AchievementCategory.DISCORD,
        name: "Amateur d'Emojis",
        description: "Utiliser 100 emojis",
        emoji: "😊",
        secret: false,
        xpReward: 75        // Commun – ~3-4 semaines pour les actifs
    },
    {
        id: "discord_emoji_500",
        category: AchievementCategory.DISCORD,
        name: "Fan d'Emojis",
        description: "Utiliser 500 emojis",
        emoji: "😎",
        secret: false,
        xpReward: 200       // Rare – ~4-5 mois pour les actifs
    },
    {
        id: "discord_emoji_1000",
        category: AchievementCategory.DISCORD,
        name: "Maître des Emojis",
        description: "Utiliser 1000 emojis",
        emoji: "🤩",
        secret: false,
        xpReward: 400       // Épique – ~8-10 mois pour les actifs
    },
    {
        id: "discord_emoji_5000",
        category: AchievementCategory.DISCORD,
        name: "Emoji Addict",
        description: "Utiliser 5000 emojis",
        emoji: "🌈",
        secret: false,
        xpReward: 1200      // Légendaire – ~3-4 ans, vraie obsession
    },
    {
        id: "discord_emoji_fav",
        category: AchievementCategory.DISCORD,
        name: "Collectionneur",
        description: "Utiliser le même emoji 100 fois",
        emoji: "😄",
        secret: false,
        xpReward: 200       // Rare – signature personnelle, ~2-3 mois
    },
    // === ACHIEVEMENTS DISCORD - COMBINÉS ===
    {
        id: "discord_social",
        category: AchievementCategory.DISCORD,
        name: "Social Butterfly",
        description: "500 messages + 200 réactions + 50h vocal",
        emoji: "🎭",
        secret: false,
        xpReward: 500       // Épique – combiné exige des 3 catégories
    },
    {
        id: "discord_active",
        category: AchievementCategory.DISCORD,
        name: "Hyperactif",
        description: "1000 messages + 500 emojis + 100 commandes",
        emoji: "💎",
        secret: false,
        xpReward: 750       // Épique haut
    },
    {
        id: "discord_legend",
        category: AchievementCategory.DISCORD,
        name: "Légende Vivante",
        description: "5000 messages + 500 réactions + 500h vocal",
        emoji: "👑",
        secret: true,
        xpReward: 2000      // Légendaire absolu
    },
    // === ACHIEVEMENTS DISCORD - SPÉCIAUX ===
    {
        id: "discord_night_owl",
        category: AchievementCategory.DISCORD,
        name: "Noctambule",
        description: "Envoyer un message à 3h du matin",
        emoji: "🌙",
        secret: true,
        xpReward: 200
    },
    {
        id: "discord_early_bird",
        category: AchievementCategory.DISCORD,
        name: "Lève-tôt",
        description: "Envoyer un message à 6h du matin",
        emoji: "☀️",
        secret: true,
        xpReward: 200
    },
    {
        id: "discord_birthday",
        category: AchievementCategory.DISCORD,
        name: "Anniversaire !",
        description: "Se connecter le jour de son anniversaire",
        emoji: "🎂",
        secret: false,
        xpReward: 300       // Rare – n'arrive qu'une fois par an
    }
];

/**
 * Charge les achievements depuis le fichier
 * @internal - Exposé pour le startup checker
 */
export function loadAchievements(): AchievementsDatabase {
    try {
        if (fs.existsSync(ACHIEVEMENTS_FILE)) {
            const data = fs.readFileSync(ACHIEVEMENTS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (error) {
        logger.error("Error loading achievements:", error);
    }
    return {};
}

/**
 * Sauvegarde les achievements dans le fichier
 * @internal - Exposé pour le startup checker
 */
export function saveAchievements(data: AchievementsDatabase): void {
    try {
        const dir = path.dirname(ACHIEVEMENTS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        fs.writeFileSync(ACHIEVEMENTS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        logger.error("Error saving achievements:", error);
    }
}

/**
 * Initialise les achievements pour un utilisateur
 * @internal - Exposé pour le startup checker
 */
export function initUserAchievements(userId: string, username: string): void {
    const data = loadAchievements();

    if (!data[userId]) {
        data[userId] = {
            username,
            achievements: ALL_ACHIEVEMENTS.map(achievement => ({
                achievementId: achievement.id,
                unlockedAt: null,
                notified: false
            })),
            lastUpdate: Date.now()
        };
        saveAchievements(data);
    }
}

/**
 * Récupère les achievements d'un utilisateur
 */
export function getUserAchievements(userId: string, username: string): UserAchievement[] {
    const data = loadAchievements();

    if (!data[userId]) {
        initUserAchievements(userId, username);
        return getUserAchievements(userId, username);
    }

    // Vérifier si de nouveaux achievements ont été ajoutés
    const existingIds = data[userId].achievements.map(a => a.achievementId);
    const newAchievements = ALL_ACHIEVEMENTS.filter(a => !existingIds.includes(a.id));

    if (newAchievements.length > 0) {
        data[userId].achievements.push(...newAchievements.map(achievement => ({
            achievementId: achievement.id,
            unlockedAt: null,
            notified: false
        })));
        data[userId].lastUpdate = Date.now();
        saveAchievements(data);
    }

    return data[userId].achievements;
}

/**
 * Débloque un achievement pour un utilisateur
 */
export async function unlockAchievement(
    userId: string,
    username: string,
    achievementId: string,
    client?: Client,
    channelId?: string
): Promise<boolean> {
    // Utiliser getUserAchievements pour s'assurer que tous les achievements sont synchronisés
    getUserAchievements(userId, username);

    let data = loadAchievements();


    const userAchievement = data[userId].achievements.find(a => a.achievementId === achievementId);

    if (!userAchievement) {
        logger.warn(`Achievement ${achievementId} not found for user ${userId}`);
        return false;
    }

    // Déjà débloqué
    if (userAchievement.unlockedAt !== null) {
        return false;
    }

    // Débloquer l'achievement
    userAchievement.unlockedAt = Date.now();
    userAchievement.notified = false;
    data[userId].username = username;
    data[userId].lastUpdate = Date.now();
    saveAchievements(data);

    logger.info(`Achievement ${achievementId} unlocked for ${username}`);

    // Récompenser l'utilisateur avec un objet de protection
    try {
        const {rewardFireProtection} = require("./rewardService");
        const {getCurrentSeasonItems} = require("./userInventoryService");

        // Choisir la récompense selon la rareté de l'achievement
        const achievement = ALL_ACHIEVEMENTS.find(a => a.id === achievementId);
        if (achievement) {
            const seasonItems = getCurrentSeasonItems();
            // Achievements secrets ou difficiles donnent de meilleures récompenses
            if (achievement.secret) {
                rewardFireProtection(userId, username, "achievement", seasonItems.large);
            } else {
                rewardFireProtection(userId, username, "achievement", seasonItems.medium);
            }
        }
    } catch (error) {
        logger.error("Error rewarding fire protection for achievement:", error);
    }

    // Envoyer une notification si un client et un channel sont fournis
    if (client && channelId && !userAchievement.notified) {
        await sendAchievementNotification(client, channelId, userId, achievementId);
        userAchievement.notified = true;
        saveAchievements(data);
    }

    return true;
}

/**
 * Envoie une notification de déblocage d'achievement
 */
async function sendAchievementNotification(
    client: Client,
    channelId: string,
    userId: string,
    achievementId: string
): Promise<void> {
    try {
        const achievement = ALL_ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!achievement) return;

        // Si c'est un appel du startup check, pas besoin de fetch le channel
        const isStartupCheck = channelId === "startup_check";

        // Fetch le channel seulement si ce n'est pas le startup check et pas un achievement de profil
        let channel: any = null;
        let isExternalContext = false; // DM, DM de groupe, ou serveur externe (UserApp)

        if (!isStartupCheck && achievement.category !== AchievementCategory.PROFIL) {
            channel = await client.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) return;

            // Vérifier si on est dans un contexte externe
            // 1. Pas de guild (DM ou DM de groupe)
            // 2. Guild différent du serveur principal (UserApp sur serveur externe)
            const GUILD_ID = process.env.GUILD_ID;
            isExternalContext = !channel.guild || (channel.guild && channel.guildId !== GUILD_ID);
        }

        const {EmbedBuilder, AttachmentBuilder} = require("discord.js");
        const path = require("path");
        const fs = require("fs");

        // Charger l'image du badge d'achievement si elle existe
        const badgeImagePath = path.join(__dirname, "../../assets/achievement_badge.png");
        let attachment = null;
        let thumbnailUrl = null;

        if (fs.existsSync(badgeImagePath)) {
            attachment = new AttachmentBuilder(badgeImagePath, {name: "achievement_badge.png"});
            thumbnailUrl = "attachment://achievement_badge.png";
        }

        // Déterminer le titre et la couleur selon la grille de rareté :
        // Commun    ≤ 75 XP  → Bronze  🟤
        // Peu commun 76–150  → Argent  🔵
        // Rare      151–300  → Violet  🟣
        // Épique    301–600  → Or      🟡
        // Légendaire > 600   → Rouge   🔴
        let embedTitle = achievement.secret ? "🔓 Succès Secret" : "✨ Succès";
        let rarityLabel = "";
        let embedColor: number;

        if (achievement.xpReward <= 75) {
            embedColor = 0xA05822;  // Bronze – Commun
            rarityLabel = "";
        } else if (achievement.xpReward <= 150) {
            embedColor = 0x5B9BD5;  // Bleu – Peu commun
            rarityLabel = " Peu Commun";
        } else if (achievement.xpReward <= 300) {
            embedColor = 0x9B59B6;  // Violet – Rare
            rarityLabel = " Rare";
        } else if (achievement.xpReward <= 600) {
            embedColor = 0xFFD700;  // Or – Épique
            rarityLabel = " Épique";
        } else {
            embedColor = 0xFF4500;  // Rouge-Orange – Légendaire
            rarityLabel = " Légendaire";
        }

        embedTitle += rarityLabel;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${embedTitle} !`)
            .setDescription(
                `## ${achievement.emoji} ${achievement.name}\n\n` +
                `*${achievement.description}*\n\n` +
                `💫 **+${achievement.xpReward} XP** gagné !\n\n` +
                `Consulte tous tes succès avec \`/profile\` ou en faisant clic droit sur ton nom : Applications → **Voir le profil** !`
            )
            .setFooter({text: "Continue comme ça pour débloquer plus de succès !"})
            .setTimestamp();

        // Ajouter la thumbnail seulement si l'image existe
        if (thumbnailUrl) {
            embed.setThumbnail(thumbnailUrl);
        }

        const messageOptions: any = {
            content: `<@${userId}> 🎉`,
            embeds: [embed],
            allowedMentions: {users: [userId]}
        };

        // Ajouter l'attachment seulement si l'image existe
        if (attachment) {
            messageOptions.files = [attachment];
        }

        let notificationSent = false;
        let targetChannel: TextChannel | null = null;

        // Décider si DM ou Public basé sur la rareté, la catégorie et le contexte
        // - Contexte externe (DM/DM de groupe/Serveur externe) : TOUJOURS en DM
        // - Achievements PROFIL : toujours en DM
        // - Achievements SECRET : toujours en DM
        // - Commun (≤ 75 XP) : en DM (trop fréquent pour spammer le chan)
        // - Peu Commun et plus (> 75 XP) : en public
        const sendInDM = (
            isExternalContext ||
            achievement.category === AchievementCategory.PROFIL ||
            achievement.secret ||
            achievement.xpReward <= 75
        );

        if (sendInDM) {
            try {
                const user = await client.users.fetch(userId);
                await user.send(messageOptions);

                if (isExternalContext) {
                    logger.info(`Achievement notification sent via DM to ${user.username} (external context)`);
                } else {
                    logger.info(`Achievement notification sent via DM to ${user.username}`);
                }

                notificationSent = true;
                // Pour les notifications de level up, on utilisera le DM du user
                targetChannel = await user.createDM() as any;
            } catch (error) {
                logger.warn(`Failed to send DM to user ${userId} (DMs probably closed), no notification sent`, error);
                // NE PAS envoyer de fallback dans le channel - simplement ne rien envoyer
                notificationSent = false;
            }
        } else {
            // Pour les autres catégories, envoyer dans le channel
            // Si c'est le startup check, on ne peut pas envoyer dans un channel
            if (!isStartupCheck && channel && channel.isTextBased()) {
                const message = await (channel as TextChannel).send(messageOptions);
                targetChannel = channel as TextChannel;
                notificationSent = true;

                // Si c'est un achievement de JEUX dans le salon compteur, supprimer après 10 secondes
                if (achievement.category === AchievementCategory.JEUX) {
                    const EnvConfig = await import("../utils/envConfig").then(m => m.EnvConfig);
                    const COUNTER_CHANNEL_ID = EnvConfig.COUNTER_CHANNEL_ID;

                    if (COUNTER_CHANNEL_ID && channelId === COUNTER_CHANNEL_ID) {
                        setTimeout(async () => {
                            try {
                                await message.delete();
                                logger.info(`Achievement notification deleted after 10s in counter channel`);
                            } catch (error) {
                                // Ignore si le message est déjà supprimé
                            }
                        }, 10000);
                    }
                }
            }
        }

        // Ajouter l'XP de l'achievement SEULEMENT si la notification a été envoyée
        // ET envoyer la notification de level up au même endroit
        if (notificationSent) {
            // Log Discord pour l'achievement
            const {logCommand} = require("../utils/discordLogger");
            const user = await client.users.fetch(userId);

            // Déterminer le type de notification
            const notificationType = sendInDM ? "DM" : "Public";
            const achievementType = achievement.secret ? "Secret" : achievement.category;

            // Récupérer le nom du canal
            let channelName = "Unknown";
            if (sendInDM) {
                channelName = `DM avec ${user.displayName || user.username}`;
            } else if (targetChannel) {
                channelName = targetChannel.name;
            }

            await logCommand("🏆 Achievement Débloqué", undefined, [
                {name: "👤 Utilisateur", value: user.username, inline: true},
                {name: "🎯 Achievement", value: `${achievement.emoji} ${achievement.name}`, inline: true},
                {name: "💫 XP", value: `+${achievement.xpReward} XP`, inline: true},
                {name: "📋 Type", value: achievementType, inline: true},
                {name: "📨 Notification", value: notificationType, inline: true}
            ], undefined, channelName, user.displayAvatarURL());

            const {addXP} = require("./xpSystem");
            const member = await client.guilds.cache.first()?.members.fetch(userId);
            if (member) {
                if (targetChannel) {
                    // La notification de level up sera envoyée dans targetChannel (DM ou channel)
                    // Utiliser skipMultiplier=true pour les achievements
                    await addXP(userId, member.user.username, achievement.xpReward, targetChannel, member.user.bot, true);
                } else {
                    // Pas de targetChannel (startup check sans DM) - attribuer XP sans notification de level up
                    // Utiliser skipMultiplier=true pour les achievements
                    await addXP(userId, member.user.username, achievement.xpReward, undefined, member.user.bot, true);
                }
            }
        } else {
            logger.info(`XP not awarded for achievement ${achievementId} because notification could not be sent`);
        }

    } catch (error) {
        logger.error("Error sending achievement notification:", error);
    }
}

/**
 * Vérifie si un achievement est débloqué
 */
export function isAchievementUnlocked(userId: string, achievementId: string): boolean {
    const data = loadAchievements();

    if (!data[userId]) return false;

    const userAchievement = data[userId].achievements.find(a => a.achievementId === achievementId);
    return userAchievement?.unlockedAt !== null;
}

/**
 * Récupère le nombre d'achievements débloqués par catégorie
 */
export function getAchievementStats(userId: string): {
    [category: string]: { unlocked: number; total: number };
} {
    const userAchievements = getUserAchievements(userId, "");
    const stats: { [category: string]: { unlocked: number; total: number } } = {};

    for (const category of Object.values(AchievementCategory)) {
        const categoryAchievements = ALL_ACHIEVEMENTS.filter(a => a.category === category);
        const unlockedCount = userAchievements.filter(ua => {
            const achievement = ALL_ACHIEVEMENTS.find(a => a.id === ua.achievementId);
            return achievement?.category === category && ua.unlockedAt !== null;
        }).length;

        stats[category] = {
            unlocked: unlockedCount,
            total: categoryAchievements.length
        };
    }

    return stats;
}

/**
 * Récupère tous les achievements d'une catégorie pour un utilisateur
 */
export function getAchievementsByCategory(
    userId: string,
    username: string,
    category: AchievementCategory
): Array<{ achievement: Achievement; unlocked: boolean; unlockedAt: number | null }> {
    const userAchievements = getUserAchievements(userId, username);

    return ALL_ACHIEVEMENTS
        .filter(a => a.category === category)
        .map(achievement => {
            const userAchievement = userAchievements.find(ua => ua.achievementId === achievement.id);
            return {
                achievement,
                unlocked: userAchievement?.unlockedAt !== null,
                unlockedAt: userAchievement?.unlockedAt || null
            };
        });
}

/**
 * Récupère le pourcentage de complétion global
 */
export function getCompletionPercentage(userId: string): number {
    const userAchievements = getUserAchievements(userId, "");
    const unlockedCount = userAchievements.filter(ua => ua.unlockedAt !== null).length;
    const totalCount = ALL_ACHIEVEMENTS.length;

    if (totalCount === 0) return 0;
    return Math.round((unlockedCount / totalCount) * 100);
}

// ============================================================================
// TRACKING DES ACHIEVEMENTS FUN
// ============================================================================

/**
 * Stockage en mémoire des compteurs de commandes fun
 */
interface FunCommandStats {
    [userId: string]: {
        username: string;
        slots: number;
        ship: number;
        dice: number;
        coinflip: number;
        crystalball: number;
        choose: number;
        ascii: number;
        cucumber: number;
        meme: number;
        quote: number;
        total: number;
        lastUpdate: number;
    };
}

const FUN_STATS_FILE = path.join(DATA_DIR, "fun_command_stats.json");

function loadFunStats(): FunCommandStats {
    try {
        if (fs.existsSync(FUN_STATS_FILE)) {
            const data = fs.readFileSync(FUN_STATS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (error) {
        logger.error("Error loading fun stats:", error);
    }
    return {};
}

function saveFunStats(stats: FunCommandStats): void {
    try {
        fs.writeFileSync(FUN_STATS_FILE, JSON.stringify(stats, null, 2), "utf-8");
    } catch (error) {
        logger.error("Error saving fun stats:", error);
    }
}

function initUserFunStats(userId: string, username: string, stats: FunCommandStats): void {
    if (!stats[userId]) {
        stats[userId] = {
            username,
            slots: 0,
            ship: 0,
            dice: 0,
            coinflip: 0,
            crystalball: 0,
            choose: 0,
            ascii: 0,
            cucumber: 0,
            meme: 0,
            quote: 0,
            total: 0,
            lastUpdate: Date.now()
        };
    }
}

/**
 * Vérifie si toutes les commandes fun ont été essayées au moins une fois
 */
function checkAllFunCommandsUsed(stats: FunCommandStats[string]): boolean {
    return stats.slots > 0 &&
        stats.ship > 0 &&
        stats.dice > 0 &&
        stats.coinflip > 0 &&
        stats.crystalball > 0 &&
        stats.choose > 0 &&
        stats.ascii > 0 &&
        stats.cucumber > 0 &&
        stats.meme > 0 &&
        stats.quote > 0;
}

/**
 * Track l'utilisation de /slots
 */
export async function trackSlotsAchievements(
    userId: string,
    username: string,
    symbols: string[],
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].slots++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].slots === 1) {
        await unlockAchievement(userId, username, "fun_slots_first", client, channelId);
    } else if (stats[userId].slots === 25) {
        await unlockAchievement(userId, username, "fun_slots_25", client, channelId);
    } else if (stats[userId].slots === 100) {
        await unlockAchievement(userId, username, "fun_slots_100", client, channelId);
    }

    // Achievement 777
    if (symbols.join("") === "7️⃣7️⃣7️⃣") {
        await unlockAchievement(userId, username, "fun_slots_777", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /ship
 */
export async function trackShipAchievements(
    userId: string,
    username: string,
    compatibility: number,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].ship++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].ship === 1) {
        await unlockAchievement(userId, username, "fun_ship_first", client, channelId);
    } else if (stats[userId].ship === 25) {
        await unlockAchievement(userId, username, "fun_ship_25", client, channelId);
    } else if (stats[userId].ship === 100) {
        await unlockAchievement(userId, username, "fun_ship_100", client, channelId);
    }

    // Achievement 100%
    if (compatibility === 100) {
        await unlockAchievement(userId, username, "fun_ship_perfect", client, channelId);
    }

    // Achievement 0%
    if (compatibility === 0) {
        await unlockAchievement(userId, username, "fun_ship_disaster", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /rollthedice
 */
export async function trackDiceAchievements(
    userId: string,
    username: string,
    diceType: string,
    result: number,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].dice++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].dice === 1) {
        await unlockAchievement(userId, username, "fun_dice_first", client, channelId);
    } else if (stats[userId].dice === 50) {
        await unlockAchievement(userId, username, "fun_dice_50", client, channelId);
    }

    // Achievement D20 naturel 20
    if (diceType === "d20" && result === 20) {
        await unlockAchievement(userId, username, "fun_dice_d20_20", client, channelId);
    }

    // Achievement D100 naturel 100
    if (diceType === "d100" && result === 100) {
        await unlockAchievement(userId, username, "fun_dice_d100_100", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /coinflip
 */
export async function trackCoinflipAchievements(
    userId: string,
    username: string,
    result: string,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].coinflip++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].coinflip === 1) {
        await unlockAchievement(userId, username, "fun_coinflip_first", client, channelId);
    } else if (stats[userId].coinflip === 25) {
        await unlockAchievement(userId, username, "fun_coinflip_25", client, channelId);
    }

    // Achievement tranche
    if (result === "tranche") {
        await unlockAchievement(userId, username, "fun_coinflip_edge", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /crystalball
 */
export async function trackCrystalballAchievements(
    userId: string,
    username: string,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].crystalball++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].crystalball === 1) {
        await unlockAchievement(userId, username, "fun_crystalball_first", client, channelId);
    } else if (stats[userId].crystalball === 50) {
        await unlockAchievement(userId, username, "fun_crystalball_50", client, channelId);
    } else if (stats[userId].crystalball === 200) {
        await unlockAchievement(userId, username, "fun_crystalball_200", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /choose
 */
export async function trackChooseAchievements(
    userId: string,
    username: string,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].choose++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].choose === 1) {
        await unlockAchievement(userId, username, "fun_choose_first", client, channelId);
    } else if (stats[userId].choose === 50) {
        await unlockAchievement(userId, username, "fun_choose_50", client, channelId);
    } else if (stats[userId].choose === 200) {
        await unlockAchievement(userId, username, "fun_choose_200", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /ascii
 */
export async function trackAsciiAchievements(
    userId: string,
    username: string,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].ascii++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].ascii === 1) {
        await unlockAchievement(userId, username, "fun_ascii_first", client, channelId);
    } else if (stats[userId].ascii === 25) {
        await unlockAchievement(userId, username, "fun_ascii_25", client, channelId);
    } else if (stats[userId].ascii === 100) {
        await unlockAchievement(userId, username, "fun_ascii_100", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /cucumber
 */
export async function trackCucumberAchievements(
    userId: string,
    username: string,
    size: number,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].cucumber++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].cucumber === 1) {
        await unlockAchievement(userId, username, "fun_cucumber_first", client, channelId);
    } else if (stats[userId].cucumber === 25) {
        await unlockAchievement(userId, username, "fun_cucumber_25", client, channelId);
    }

    // Achievement 25cm
    if (size === 25) {
        await unlockAchievement(userId, username, "fun_cucumber_legendary", client, channelId);
    }

    // Achievement 1cm (le minimum)
    if (size === 1) {
        await unlockAchievement(userId, username, "fun_cucumber_tiny", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track l'utilisation de /findmeme
 */
export async function trackMemeAchievements(
    userId: string,
    username: string,
    client?: Client,
    channelId?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].meme++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre
    if (stats[userId].meme === 1) {
        await unlockAchievement(userId, username, "fun_meme_first", client, channelId);
    } else if (stats[userId].meme === 10) {
        await unlockAchievement(userId, username, "fun_meme_10", client, channelId);
    } else if (stats[userId].meme === 50) {
        await unlockAchievement(userId, username, "fun_meme_50", client, channelId);
    } else if (stats[userId].meme === 200) {
        await unlockAchievement(userId, username, "fun_meme_200", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Track la création d'une citation (/quote ou menu contextuel)
 * @param userId       Celui qui crée la citation
 * @param username     Son username
 * @param quotedUserId L'utilisateur cité (pour l'achievement "Immortalisé")
 * @param quotedUsername Son username
 */
export async function trackQuoteAchievements(
    userId: string,
    username: string,
    client?: Client,
    channelId?: string,
    quotedUserId?: string,
    quotedUsername?: string
): Promise<void> {
    const stats = loadFunStats();
    initUserFunStats(userId, username, stats);

    stats[userId].quote++;
    stats[userId].total++;
    stats[userId].username = username;
    stats[userId].lastUpdate = Date.now();
    saveFunStats(stats);

    // Achievements basés sur le nombre (créateur)
    if (stats[userId].quote === 1) {
        await unlockAchievement(userId, username, "fun_quote_first", client, channelId);
    } else if (stats[userId].quote === 10) {
        await unlockAchievement(userId, username, "fun_quote_10", client, channelId);
    } else if (stats[userId].quote === 50) {
        await unlockAchievement(userId, username, "fun_quote_50", client, channelId);
    }

    // Achievement "Immortalisé" : la personne citée (si différente du créateur)
    if (quotedUserId && quotedUsername && quotedUserId !== userId) {
        await unlockAchievement(quotedUserId, quotedUsername, "fun_quote_immortaliser", client, channelId);
    }

    // Vérifier achievements globaux
    await checkGlobalFunAchievements(userId, username, stats, client, channelId);
}

/**
 * Vérifie les achievements globaux de la catégorie FUN
 */
async function checkGlobalFunAchievements(
    userId: string,
    username: string,
    stats: FunCommandStats,
    client?: Client,
    channelId?: string
): Promise<void> {
    const userStats = stats[userId];

    // Achievement "Touche-à-Tout Fun"
    if (checkAllFunCommandsUsed(userStats)) {
        await unlockAchievement(userId, username, "fun_try_all", client, channelId);
    }

    // Achievement "Accro au Fun"
    if (userStats.total >= 500) {
        await unlockAchievement(userId, username, "fun_addict", client, channelId);
    }
}

/**
 * Track les achievements Blackjack
 */
export async function trackBlackjackAchievements(
    userId: string,
    username: string,
    hasWon: boolean,
    isNaturalBlackjack: boolean,
    has21With5Cards: boolean,
    client?: Client,
    channelId?: string
): Promise<void> {
    const {getPlayerStats} = require("../games/common/globalStats");
    const stats = getPlayerStats(userId);

    // Achievement première partie
    const totalGames = stats.blackjack.wins + stats.blackjack.losses + stats.blackjack.draws;
    if (totalGames === 1) {
        await unlockAchievement(userId, username, "blackjack_first", client, channelId);
    }

    // Achievements basés sur les victoires
    if (hasWon) {
        if (stats.blackjack.wins === 10) {
            await unlockAchievement(userId, username, "blackjack_win_10", client, channelId);
        } else if (stats.blackjack.wins === 50) {
            await unlockAchievement(userId, username, "blackjack_win_50", client, channelId);
        }

        // Achievement série de 5
        if (stats.blackjack.currentStreak === 5) {
            await unlockAchievement(userId, username, "blackjack_streak_5", client, channelId);
        }

        // Achievement Blackjack naturel
        if (isNaturalBlackjack) {
            await unlockAchievement(userId, username, "blackjack_natural", client, channelId);
        }

        // Achievement secret: 21 avec 5 cartes ou plus
        if (has21With5Cards) {
            await unlockAchievement(userId, username, "blackjack_21_perfect", client, channelId);
        }
    }
}

