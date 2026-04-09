import {ChatInputCommandInteraction, PermissionFlagsBits} from "discord.js";
import {EnvConfig} from "./envConfig";
import {MODERATOR_ROLES, OWNER_ROLES} from "./constants";

/**
 * Liste des commandes réservées au propriétaire du bot
 * Ces commandes ne peuvent être utilisées qu'en serveur par l'owner
 */
const OWNER_COMMANDS = [
    'lowpower',
    'auto-lowpower',
    'blacklist-game',
    'test-rewind',
    'set-status',
    'test-event',
    'stop-event',
    'reset-counter',
    'check-free-games',
    'configure-free-games',
];

/**
 * Liste des commandes réservées aux administrateurs (et owner)
 * Ces commandes ne peuvent être utilisées qu'en serveur par les admins
 */
const ADMIN_COMMANDS = [
    'reset'
];

/**
 * Liste des commandes qui peuvent être exécutées partout (aucune restriction de canal)
 */
const GLOBAL_COMMANDS = [
    'add-note',
    'remove-note',
    'profile',
    'set-birthday',
    'remove-birthday',
    'stop',
    'reset-dm',
    'leaderboard',
    'test-mission',
    'challenges',
    'answer',
    'harvest',
    'quote',
    'freestuff',
    // Ajoutez ici d'autres commandes qui peuvent être utilisées n'importe où
];

/**
 * Liste des commandes spéciales avec restrictions personnalisées
 */
const SPECIAL_COMMANDS = {
    findmeme: 'MEME_CHANNEL',
    imagine: 'COMMAND_CHANNEL',
    reimagine: 'COMMAND_CHANNEL',
    upscale: 'COMMAND_CHANNEL',
    'prompt-maker': 'COMMAND_CHANNEL',
    games: 'COMMAND_CHANNEL',
    rollthedice: 'COMMAND_CHANNEL',
    'crystalball': 'COMMAND_CHANNEL',
    choose: 'COMMAND_CHANNEL',
    coinflip: 'COMMAND_CHANNEL',
    daily: 'COMMAND_CHANNEL',
    ascii: 'COMMAND_CHANNEL',
    ship: 'COMMAND_CHANNEL',
    cucumber: 'COMMAND_CHANNEL',
    slots: 'COMMAND_CHANNEL',
} as const;

/**
 * Vérifie si un utilisateur a un rôle owner
 */
function hasOwnerRole(interaction: ChatInputCommandInteraction): boolean {
    if (!interaction.guild || !interaction.member) return false;

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) return false;

    return OWNER_ROLES.some(roleId => member.roles.cache.has(roleId));
}

/**
 * Vérifie si un utilisateur a un rôle moderator
 */
function hasModeratorRole(interaction: ChatInputCommandInteraction): boolean {
    if (!interaction.guild || !interaction.member) return false;

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) return false;

    return MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));
}

/**
 * Vérifie si une commande peut être exécutée dans le canal actuel
 *
 * Règles:
 * - Commandes GLOBAL : Peuvent être utilisées partout (DM et tous les salons)
 * - Commandes OWNER : Seulement sur serveur par l'owner (vérifie les rôles)
 * - Commandes ADMIN : Seulement sur serveur par les admins, moderators ou l'owner
 * - Commandes SPECIAL : Restrictions personnalisées (ex: findmeme dans salon meme)
 * - Autres commandes : DMs autorisés OU salon NETRICSA sur serveur
 *
 * @param interaction L'interaction de la commande
 * @returns true si la commande peut être exécutée, false sinon
 */
export function canExecuteCommand(interaction: ChatInputCommandInteraction): boolean {
    const commandName = interaction.commandName;
    const isOwnerCommand = OWNER_COMMANDS.includes(commandName);
    const isAdminCommand = ADMIN_COMMANDS.includes(commandName);
    const isGlobalCommand = GLOBAL_COMMANDS.includes(commandName);
    const isSpecialCommand = commandName in SPECIAL_COMMANDS;

    // Commandes globales : peuvent être exécutées partout (DM et n'importe quel salon)
    if (isGlobalCommand) {
        return true;
    }

    // Commandes owner : uniquement sur serveur par l'owner
    if (isOwnerCommand) {
        // Bloquer en DM
        if (!interaction.guild) {
            return false;
        }

        // Vérifier si l'utilisateur a un rôle owner
        return hasOwnerRole(interaction);
    }

    // Commandes admin : uniquement sur serveur par les admins, moderators ou l'owner
    if (isAdminCommand) {
        // Bloquer en DM
        if (!interaction.guild) {
            return false;
        }

        // Autoriser les owners
        if (hasOwnerRole(interaction)) {
            return true;
        }

        // Autoriser les moderators
        if (hasModeratorRole(interaction)) {
            return true;
        }

        // Vérifier les permissions admin
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member) return false;

        return member.permissions.has(PermissionFlagsBits.Administrator);
    }

    // Commandes spéciales : restrictions personnalisées
    if (isSpecialCommand) {
        const restriction = SPECIAL_COMMANDS[commandName as keyof typeof SPECIAL_COMMANDS];

        if (restriction === 'MEME_CHANNEL') {
            // Les DMs sont autorisés
            if (!interaction.guild) {
                return true;
            }

            // Sur serveur : vérifier qu'on est dans le salon meme
            const memeChannelId = EnvConfig.MEME_CHANNEL_ID;

            if (!memeChannelId) {
                // Si le salon meme n'est pas configuré, bloquer
                return false;
            }

            return interaction.channelId === memeChannelId;
        }

        if (restriction === 'COMMAND_CHANNEL') {
            // Les DMs sont autorisés
            if (!interaction.guild) {
                return true;
            }

            // Sur serveur : vérifier qu'on est dans le salon commandes
            const commandChannelId = EnvConfig.COMMAND_CHANNEL_ID;

            if (!commandChannelId) {
                // Si le salon commande n'est pas configuré, bloquer
                return false;
            }

            return interaction.channelId === commandChannelId;
        }
    }

    // Commandes utilisateur : DMs autorisés OU salon NETRICSA sur serveur

    // Les DMs sont autorisés
    if (!interaction.guild) {
        return true;
    }

    // Sur serveur : vérifier qu'on est dans le salon NETRICSA
    const netricsaChannelId = EnvConfig.WATCH_CHANNEL_ID;

    if (!netricsaChannelId) {
        // Si le salon NETRICSA n'est pas configuré, autoriser partout (fallback)
        return true;
    }

    return interaction.channelId === netricsaChannelId;
}

/**
 * Retourne un message d'erreur approprié si la commande ne peut pas être exécutée
 *
 * @param interaction L'interaction de la commande
 * @returns Le message d'erreur à afficher
 */
export function getCommandRestrictionMessage(interaction: ChatInputCommandInteraction): string {
    const commandName = interaction.commandName;
    const isOwnerCommand = OWNER_COMMANDS.includes(commandName);
    const isAdminCommand = ADMIN_COMMANDS.includes(commandName);
    const isSpecialCommand = commandName in SPECIAL_COMMANDS;

    if (isOwnerCommand) {
        if (!interaction.guild) {
            return "Cette commande ne peut pas être utilisée en message privé.";
        }
        return "Cette commande est réservée au propriétaire du bot.";
    }

    if (isAdminCommand) {
        if (!interaction.guild) {
            return "Cette commande ne peut pas être utilisée en message privé.";
        }
        return "Cette commande est réservée aux administrateurs du serveur.";
    }

    if (isSpecialCommand) {
        const restriction = SPECIAL_COMMANDS[commandName as keyof typeof SPECIAL_COMMANDS];

        if (restriction === 'MEME_CHANNEL') {
            const memeChannelId = EnvConfig.MEME_CHANNEL_ID;
            if (memeChannelId) {
                return "Cette commande ne peut être utilisée que dans le salon <#" + memeChannelId + "> ou en message privé.";
            }
            return "Cette commande ne peut être utilisée qu'en message privé (le salon meme n'est pas configuré).";
        }

        if (restriction === 'COMMAND_CHANNEL') {
            const commandChannelId = EnvConfig.COMMAND_CHANNEL_ID;
            if (commandChannelId) {
                return "Cette commande ne peut être utilisée que dans le salon <#" + commandChannelId + "> ou en message privé.";
            }
            return "Cette commande ne peut être utilisée qu'en message privé (le salon commande n'est pas configuré).";
        }
    }

    return "Cette commande ne peut être utilisée que dans le salon <#" + EnvConfig.WATCH_CHANNEL_ID + "> ou en message privé.";
}
