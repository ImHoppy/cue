import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import {
	admins,
	authEnabled,
	cookieSecure,
	publicUrl,
	sessionMaxAgeMs,
	twitchClientId,
	twitchClientSecret,
} from "./config.js";
import { getUser, upsertUser, type User } from "./db.js";

const SESSION = "sid";
const STATE = "oauth_state";
const redirectUri = `${publicUrl}/auth/callback`;

export const cookieBase = { path: "/", httpOnly: true, secure: cookieSecure, sameSite: "lax", signed: true } as const;

export function authorizeUrl(reply: FastifyReply): string {
	const state = randomBytes(16).toString("base64url");
	reply.setCookie(STATE, state, { ...cookieBase, maxAge: 600 });
	const params = new URLSearchParams({
		client_id: twitchClientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "",
		state,
	});
	return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

export function readSigned(req: FastifyRequest, name: string): string | null {
	const raw = req.cookies[name];
	if (!raw) return null;
	const result = req.unsignCookie(raw);
	return result.valid ? result.value : null;
}

/** Exchanges the code and starts a session. Returns the user, or null if the flow failed. */
export async function completeLogin(
	req: FastifyRequest,
	reply: FastifyReply,
	code: string,
	state: string
): Promise<User | null> {
	const expected = readSigned(req, STATE);
	reply.clearCookie(STATE, { path: "/" });
	if (!expected || expected !== state) return null;

	const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: twitchClientId,
			client_secret: twitchClientSecret,
			code,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		}),
	});
	if (!tokenRes.ok) return null;
	const token = (await tokenRes.json()) as { access_token?: string };
	if (!token.access_token) return null;

	const userRes = await fetch("https://api.twitch.tv/helix/users", {
		headers: { authorization: `Bearer ${token.access_token}`, "client-id": twitchClientId },
	});
	if (!userRes.ok) return null;
	const body = (await userRes.json()) as {
		data?: Array<{ id?: unknown; login?: string; display_name?: string; profile_image_url?: string }>;
	};
	const profile = body.data?.[0];
	if (!profile || typeof profile.id !== "string") return null;

	const user = upsertUser({
		twitchId: profile.id,
		login: profile.login ?? "",
		displayName: profile.display_name || profile.login || "streamer",
		avatarUrl: profile.profile_image_url ?? null,
	});

	startSession(reply, user);
	return user;
}

export function startSession(reply: FastifyReply, user: User) {
	const payload = JSON.stringify({ uid: user.id, tid: user.twitch_id, exp: Date.now() + sessionMaxAgeMs });
	reply.setCookie(SESSION, payload, { ...cookieBase, maxAge: sessionMaxAgeMs / 1000 });
}

/** The signed-in user, re-read from the database each request so a change lands at once. */
export function currentUser(req: FastifyRequest): User | null {
	const raw = readSigned(req, SESSION);
	if (!raw) return null;
	try {
		const { uid, tid, exp } = JSON.parse(raw) as { uid?: unknown; tid?: unknown; exp?: unknown };
		if (typeof uid !== "number" || typeof exp !== "number" || Date.now() > exp) return null;
		const user = getUser(uid);
		// The cookie carries the Twitch id too, so a recycled row id cannot inherit a session.
		return user && user.twitch_id === tid ? user : null;
	} catch {
		return null;
	}
}

export const isAdmin = (user: User | null) => !!user && admins.has(user.twitch_id);

export function logout(reply: FastifyReply) {
	reply.clearCookie(SESSION, { path: "/" });
}

/** preHandler for JSON endpoints. Page routes redirect to sign-in instead. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
	if (!authEnabled) return reply.code(503).send({ error: "sign_in_not_configured" });
	if (!currentUser(req)) return reply.code(401).send({ error: "not_signed_in" });
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
	if (!isAdmin(currentUser(req))) return reply.code(403).send({ error: "forbidden" });
}
