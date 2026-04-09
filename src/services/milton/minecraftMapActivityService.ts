import {InviteTargetType, StageChannel, VoiceChannel} from "discord.js";
import {EnvConfig} from "../../utils/envConfig";
import {createLogger} from "../../utils/logger";

const logger = createLogger("MiltonMapActivity");

export type MiltonMapLaunchResult =
    | {
    mode: "embedded";
    inviteUrl: string;
    mapUrl: string;
    applicationId: string;
}
    | {
    mode: "link";
    mapUrl: string;
    reason: string;
};

/**
 * Cree une invitation d'activite Discord si l'Application ID est configure,
 * sinon retourne un fallback lien direct vers la carte Milton.
 */
export async function createMiltonMapLaunch(channel: VoiceChannel | StageChannel): Promise<MiltonMapLaunchResult> {
    const mapUrl = (EnvConfig.MILTON_MAP_URL || "http://tnss-smp.duckdns.org:8123/#").trim();
    const applicationId = EnvConfig.MILTON_ACTIVITY_APPLICATION_ID?.trim();

    if (!applicationId) {
        return {
            mode: "link",
            mapUrl,
            reason: "MILTON_ACTIVITY_APPLICATION_ID non configure"
        };
    }

    try {
        const invite = await channel.createInvite({
            maxAge: 60 * 60 * 24,
            maxUses: 0,
            temporary: false,
            unique: true,
            targetType: InviteTargetType.EmbeddedApplication,
            targetApplication: applicationId
        });

        return {
            mode: "embedded",
            inviteUrl: invite.url,
            mapUrl,
            applicationId
        };
    } catch (error) {
        logger.error(`Impossible de creer une invite embedded pour ${channel.id}:`, error);
        return {
            mode: "link",
            mapUrl,
            reason: "creation d'invite embedded impossible"
        };
    }
}

