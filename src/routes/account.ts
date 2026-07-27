import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { currentUser, isAdmin, requireUser } from "../auth.js";
import { downloadsDir, publicUrl } from "../config.js";
import { availableProviderIds, normalizeSettings, transportFor } from "../contract.js";
import {
	ensureKeys,
	issueKeys,
	keysForUser,
	loadSettings,
	rotateReadKey,
	saveSettings,
	setProvider,
	setSetupDone,
	spotifyForUser,
	type User,
} from "../db.js";
import { clientsFor, dropHub, pushSettings } from "../hubs.js";
import { canLinkSpotify, spotifyLinkClosed } from "../spotify.js";
import { maskKey } from "../../shared/contract.js";

export const overlayUrlFor = (readKey: string) => `${publicUrl}/overlay?key=${readKey}`;

export const buildAvailable = (target: string) => existsSync(join(downloadsDir, `${target}.zip`));

const providersFor = (user: User) =>
	availableProviderIds.filter((id) => id !== "spotify" || canLinkSpotify(user));

function accountView(user: User) {
	const keys = keysForUser(user.id);
	const spotify = spotifyForUser(user.id);
	return {
		user: {
			login: user.login,
			displayName: user.display_name,
			avatarUrl: user.avatar_url,
			isAdmin: isAdmin(user),
		},
		provider: user.provider,
		availableProviders: providersFor(user),
		spotify: spotify ? { displayName: spotify.displayName } : null,
		spotifyClosed: spotifyLinkClosed(user),
		setupDone: !!user.setup_done,
		key: keys ? { prefix: keys.write_key_prefix, masked: maskKey(keys.write_key_prefix) } : null,
		overlayUrl: keys ? overlayUrlFor(keys.read_key) : null,
		settings: loadSettings(user.id),
		overlayConnected: keys ? clientsFor(keys.read_key) : 0,
		downloads: { chrome: buildAvailable("chrome"), firefox: buildAvailable("firefox") },
	};
}

export function registerAccount(app: FastifyInstance) {
	app.register(async (api) => {
		api.addHook("preHandler", requireUser);

		api.get("/api/me", async (req) => accountView(currentUser(req)!));

		/** Polled by the dashboard to light the "OBS is connected" lamp. */
		api.get("/api/me/status", async (req) => {
			const keys = keysForUser(currentUser(req)!.id);
			return { overlayConnected: keys ? clientsFor(keys.read_key) : 0 };
		});

		api.post("/api/me/provider", async (req, reply) => {
			const body = z.object({ provider: z.string() }).safeParse(req.body);
			const user = currentUser(req)!;
			if (!body.success || !providersFor(user).includes(body.data.provider)) {
				return reply.code(400).send({ error: "unsupported_provider" });
			}
			setProvider(user.id, body.data.provider);
			if (transportFor(body.data.provider) === "account") ensureKeys(user.id);
			return accountView(currentUser(req)!);
		});

		api.put("/api/me/settings", async (req, reply) => {
			const body = z.object({ settings: z.record(z.unknown()) }).safeParse(req.body);
			if (!body.success) return reply.code(400).send({ error: "invalid_settings" });

			const user = currentUser(req)!;
			const settings = saveSettings(user.id, normalizeSettings(body.data.settings));
			const keys = keysForUser(user.id);
			// Reaches an overlay that is already open in OBS, live.
			if (keys) pushSettings(keys.read_key, settings);
			return { settings };
		});

		api.post("/api/me/setup-done", async (req) => {
			const user = currentUser(req)!;
			setSetupDone(user.id, true);
			return accountView(currentUser(req)!);
		});

		/** Invalidates the old write key immediately; the overlay URL is untouched. */
		api.post("/api/me/key/regenerate", async (req) => {
			const user = currentUser(req)!;
			const { writeKey, readKey } = issueKeys(user.id);
			return { writeKey, overlayUrl: overlayUrlFor(readKey), account: accountView(currentUser(req)!) };
		});

		/** New overlay URL, for when the old one ended up on stream. The extension keeps working. */
		api.post("/api/me/overlay-url/rotate", async (req, reply) => {
			const user = currentUser(req)!;
			const previous = keysForUser(user.id);
			const next = rotateReadKey(user.id);
			if (!next) return reply.code(409).send({ error: "no_key" });
			if (previous) dropHub(previous.read_key);
			return { overlayUrl: overlayUrlFor(next), account: accountView(currentUser(req)!) };
		});
	});
}
