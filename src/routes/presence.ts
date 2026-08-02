import type { FastifyInstance, FastifyReply } from "fastify";
import { normalizeSettings, presenceSchema } from "../contract.js";
import { loadSettings, markProducerSeen, resolveWriteKey, saveSettings } from "../db.js";
import { countPresence, hubForWrite } from "../hubs.js";
import { publicUrl } from "../config.js";
import { buildVersions } from "./account.js";

// Cors protected by bearer token
const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "authorization, content-type",
	"access-control-max-age": "86400",
} as const;

function bearer(header: string | undefined): string | null {
	if (!header) return null;
	const m = /^Bearer\s+(.+)$/i.exec(header.trim());
	return m?.[1]?.trim() || null;
}

const preflight = async (_req: unknown, reply: FastifyReply) => reply.headers(CORS).code(204).send();

export function registerPresence(app: FastifyInstance) {
	// Encapsulated, so the CORS hook reaches these routes and nothing else.
	app.register(async (api) => {
		api.addHook("onSend", async (_req, reply, payload) => {
			reply.headers(CORS);
			return payload;
		});

		api.options("/api/presence", preflight);
		api.options("/api/settings", preflight);

		api.get("/api/extension/version", {
			config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
			handler: async () => ({ versions: buildVersions() }),
		});

		api.get("/api/settings", async (req, reply) => {
			const writeKey = bearer(req.headers.authorization);
			const keys = writeKey && resolveWriteKey(writeKey);
			if (!keys) return reply.code(401).send({ error: "invalid_write_key" });
			return {
				settings: loadSettings(keys.user_id),
				readKey: keys.read_key,
				overlayUrl: `${publicUrl}/overlay?key=${keys.read_key}`,
			};
		});

		api.post("/api/presence", {
			config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
			handler: async (req, reply) => {
				const writeKey = bearer(req.headers.authorization);
				if (!writeKey) return reply.code(401).send({ error: "missing_write_key" });

				const keys = resolveWriteKey(writeKey);
				if (!keys) return reply.code(401).send({ error: "invalid_write_key" });

				const parsed = presenceSchema.safeParse(req.body);
				if (!parsed.success) {
					return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.issues });
				}

				countPresence();
				markProducerSeen(keys.user_id);

				const hub = hubForWrite(keys.read_key);
				if (parsed.data.type === "NOW_PLAYING") {
					hub.lastState = parsed.data.payload;
					hub.broadcast("state", JSON.stringify(parsed.data.payload));
				} else {
					hub.settings = saveSettings(keys.user_id, normalizeSettings(parsed.data.payload));
					hub.broadcast("settings", JSON.stringify(hub.settings));
				}
				return reply.code(204).send();
			},
		});
	});
}
