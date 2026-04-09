import {Client} from "discord.js";
import {createLogger} from "../../utils/logger";
import {startMinecraftOnlineChannelUpdater} from "./minecraftOnlineChannelService";

const logger = createLogger("MiltonBot");

export class MiltonBot {
    private started = false;

    public start(client: Client): void {
        if (this.started) {
            return;
        }

        startMinecraftOnlineChannelUpdater(client);
        this.started = true;
        logger.info("Milton Minecraft service initialized in the same process");
    }
}

let instance: MiltonBot | null = null;

export function getMiltonBot(): MiltonBot {
    if (!instance) {
        instance = new MiltonBot();
    }

    return instance;
}

