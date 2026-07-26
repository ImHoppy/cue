import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth.js";
import { collectStats, listUsers } from "../db.js";
import { hubStats } from "../hubs.js";

export function registerAdmin(app: FastifyInstance) {
	app.register(async (admin) => {
		admin.addHook("preHandler", requireAdmin);

		admin.get("/api/admin/stats", async () => ({
			live: hubStats(),
			...collectStats(30),
		}));

		admin.get("/api/admin/users", async () => ({
			users: listUsers().map((u) => ({
				twitchId: u.twitch_id,
				login: u.login,
				displayName: u.display_name,
				avatarUrl: u.avatar_url,
				provider: u.provider,
				spotifyLinked: !!u.spotify_linked,
				setupDone: !!u.setup_done,
				createdAt: u.created_at,
				lastLoginAt: u.last_login_at,
				lastSeenAt: u.last_seen_at,
				overlaySeenAt: u.overlay_seen_at,
			})),
		}));
	});
}
