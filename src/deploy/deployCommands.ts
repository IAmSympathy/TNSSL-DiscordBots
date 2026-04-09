import path from "path";
import {REST, Routes} from "discord.js";
import {createLogger} from "../utils/logger";

const logger = createLogger("DeployCommands");

// Liste des commandes qui doivent être UNIQUEMENT dans le serveur (pas exportées en externe)
const GUILD_ONLY_COMMANDS = [
    "reset",
    "reset-counter",
    "add-note",
    "set-birthday",
    "remove-birthday",
    "remove-note",
    "set-status",
    "stop-event",
    "test-event",
    "auto-lowpower",
    "blacklist",
    "blacklist-game",
    "whitelist-game",
    "lowpower",
    "leaderboard",
    "test-mission",
    "test-rewind",
    "standby-status",
    "findmeme",
    "answer",
    "harvest",
    "Déplacer le message", // Commande de menu contextuel
    "configure-free-games" // Commande d'administration pour configurer les jeux gratuits (ex: ajouter un nouveau store)
];

const globalCommands: any[] = [];
const guildOnlyCommands: any[] = [];
const foldersPath = path.join(__dirname, "..", "commands");
const commandFolders = require("fs").readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = require("fs")
        .readdirSync(commandsPath)
        .filter((file: string) => file.endsWith(".js"));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ("data" in command && "execute" in command) {
            const commandData = command.data.toJSON();

            // Vérifier si c'est une commande guild-only
            if (GUILD_ONLY_COMMANDS.includes(commandData.name)) {
                guildOnlyCommands.push(commandData);
            } else {
                globalCommands.push(commandData);
            }
        } else {
            logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const deployCommands = async () => {
    const rest = new REST().setToken(process.env.DISCORD_LLM_BOT_TOKEN!);
    const GUILD_ID = process.env.GUILD_ID!;

    try {
        logger.info(`Started refreshing application (/) commands.`);
        logger.info(`- ${globalCommands.length} global commands (with User App support)`);
        logger.info(`- ${guildOnlyCommands.length} guild-only commands (admin/owner)`);

        // Déployer les commandes globales avec User App support
        const globalCommandsWithUserApp = globalCommands.map(cmd => ({
            ...cmd,
            // 0 = Guild Install (serveur), 1 = User Install (application utilisateur)
            integration_types: [0, 1],
            // 0 = Guild (serveur), 1 = Bot DM, 2 = Group DM
            contexts: [0, 1, 2]
        }));

        const globalData: any = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_LLM_BOT_CLIENT_ID!),
            {body: globalCommandsWithUserApp}
        );

        logger.info(`✅ Successfully deployed ${globalData.length} global commands with User App support.`);

        // Déployer les commandes guild-only (uniquement dans le serveur, pas de User Apps)
        const guildData: any = await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_LLM_BOT_CLIENT_ID!, GUILD_ID),
            {body: guildOnlyCommands}
        );

        logger.info(`✅ Successfully deployed ${guildData.length} guild-only commands (admin/owner).`);

    } catch (error) {
        logger.error("Error deploying commands:", error);
    }
};
export default deployCommands;
