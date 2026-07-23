import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { cookieBase, currentUser, readSigned, requireUser } from "../auth.js";
import { publicHost, publicUrl, spotifyEnabled } from "../config.js";
import { ensureKeys, linkSpotify, setProvider, spotifyForUser, unlinkSpotify } from "../db.js";
import { exchangeCode, fetchProfile, spotifyAuthorizeUrl } from "../spotify.js";

const STATE = "spotify_state";

const back = (setup: boolean) => (setup ? "/setup" : "/dashboard");

export function registerSpotify(app: FastifyInstance) {
	app.get("/auth/spotify", async (req, reply) => {
		const user = currentUser(req);
		if (!user) return reply.redirect("/");
		if (!spotifyEnabled) return reply.redirect(`${back(!user.setup_done)}?spotify=unconfigured`);

		const state = randomBytes(16).toString("base64url");
		reply.setCookie(STATE, state, { ...cookieBase, maxAge: 600 });
		return reply.redirect(spotifyAuthorizeUrl(state));
	});

	app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
		"/auth/spotify/callback",
		async (req, reply) => {
			if (req.headers.host && req.headers.host !== publicHost) {
				const query = new URLSearchParams(
					Object.entries(req.query).filter((e): e is [string, string] => typeof e[1] === "string")
				);
				return reply.redirect(`${publicUrl}/auth/spotify/callback?${query}`);
			}

			const user = currentUser(req);
			if (!user) return reply.redirect("/");

			const expected = readSigned(req, STATE);
			reply.clearCookie(STATE, { path: "/" });

			const { code, state, error } = req.query;
			const fail = (detail: string) => {
				req.log.warn({ detail }, "spotify link failed");
				return reply.redirect(`${back(!user.setup_done)}?spotify=failed`);
			};

			if (error) return fail(`spotify returned ${error}`);
			if (!code || !state) return fail("callback carried no code or state");
			if (!expected || expected !== state) return fail("state cookie missing or mismatched");

			const result = await exchangeCode(code);
			if (!result.ok) return fail(result.detail);
			const { tokens } = result;

			const profile = await fetchProfile(tokens.accessToken);

			linkSpotify({
				userId: user.id,
				spotifyId: profile?.id ?? "",
				displayName: profile?.displayName ?? null,
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: tokens.expiresAt,
			});
			setProvider(user.id, "spotify");
			ensureKeys(user.id);
			return reply.redirect(`${back(!user.setup_done)}?spotify=linked`);
		}
	);

	app.register(async (api) => {
		api.addHook("preHandler", requireUser);

		api.post("/api/me/spotify/disconnect", async (req) => {
			const user = currentUser(req)!;
			unlinkSpotify(user.id);
			return { spotify: null };
		});

		api.get("/api/me/spotify", async (req) => {
			const link = spotifyForUser(currentUser(req)!.id);
			return { spotify: link ? { displayName: link.displayName } : null };
		});
	});
}
