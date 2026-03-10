import express, {Request, Response} from "express";
import {Client} from "discord.js";
import {processAnnouncement, processProductUpdate} from "./freeGamesService";
import {createLogger} from "../utils/logger";
import {EnvConfig} from "../utils/envConfig";

const logger = createLogger("FreeStuffWebhook");

/**
 * Interface pour les événements webhook de FreeStuff
 */
interface WebhookEvent {
    type: string;
    timestamp: string;
    data: any;
}

/**
 * Crée un serveur Express pour recevoir les webhooks de FreeStuff
 */
export function setupFreeStuffWebhook(client: Client, port: number = 3000): void {
    const apiKey = EnvConfig.FREESTUFF_API_KEY;

    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
        logger.warn("FreeStuff webhook not configured: API key missing");
        return;
    }

    const app = express();

    // Middleware pour parser le JSON (mais on garde le raw body pour la vérification)
    app.use(express.json({
        verify: (req: any, res, buf, encoding) => {
            req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
        }
    }));

    /**
     * Endpoint webhook pour FreeStuff
     */
    app.post("/webhooks/freestuff", async (req: Request, res: Response) => {
        try {
            // Récupérer les headers de vérification
            const webhookId = req.headers["webhook-id"] as string;
            const webhookTimestamp = req.headers["webhook-timestamp"] as string;
            const webhookSignature = req.headers["webhook-signature"] as string;
            const compatibilityDate = req.headers["x-compatibility-date"] as string;

            logger.debug(`Received webhook: ${webhookId} at ${webhookTimestamp}`);
            logger.debug(`Compatibility date: ${compatibilityDate}`);

            // TODO: Implémenter la vérification de signature Ed25519
            // Pour l'instant, on fait confiance (à améliorer en production)

            const event: WebhookEvent = req.body;

            logger.info(`Processing FreeStuff event: ${event.type}`);

            // Traiter l'événement selon son type
            switch (event.type) {
                case "fsb:event:ping":
                    logger.info("Received ping event");
                    if (event.data?.manual) {
                        logger.info("Manual ping from dashboard");
                    }
                    break;

                case "fsb:event:announcement_created":
                    logger.info("New announcement received");
                    await processAnnouncement(client, event.data);
                    break;

                case "fsb:event:product_updated":
                    logger.info("Product update received");
                    await processProductUpdate(client, event.data);
                    break;

                default:
                    logger.warn(`Unknown event type: ${event.type}`);
            }

            // Répondre avec un 204 No Content comme recommandé
            res.status(204).send();

        } catch (error) {
            logger.error("Error processing webhook:", error);
            res.status(500).json({error: "Internal server error"});
        }
    });

    /**
     * Endpoint de santé
     */
    app.get("/health", (req: Request, res: Response) => {
        res.status(200).json({
            status: "ok",
            service: "freestuff-webhook",
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Démarrer le serveur
     */
    app.listen(port, "0.0.0.0", () => {
        const publicUrl = EnvConfig.WEBHOOK_PUBLIC_URL;
        logger.info(`✅ FreeStuff webhook server listening on port ${port}`);
        logger.info(`   Webhook URL: ${publicUrl}/webhooks/freestuff`);
        logger.info(`   Configure this URL at: https://dashboard.freestuffbot.xyz/`);
    });
}


