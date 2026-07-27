import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findPackageRoot(from: string): string {
	for (let dir = from, up = ""; dir !== up; up = dir, dir = dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) return dir;
	}
	return from;
}

const rootDir = resolve(process.env.ROOT_DIR ?? findPackageRoot(dirname(fileURLToPath(import.meta.url))));

export const sharedDir = resolve(process.env.SHARED_DIR ?? join(rootDir, "shared"));
export const overlayDir = resolve(process.env.OVERLAY_DIR ?? join(rootDir, "overlay"));
export const publicDir = resolve(process.env.PUBLIC_DIR ?? join(rootDir, "public"));
export const downloadsDir = resolve(process.env.DOWNLOADS_DIR ?? join(rootDir, "extension", "dist"));

export const port = Number(process.env.PORT ?? 8080);
export const host = process.env.HOST ?? "0.0.0.0";
export const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
export const publicHost = new URL(publicUrl).host;

export const twitchClientId = process.env.TWITCH_CLIENT_ID ?? "";
export const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET ?? "";
export const authEnabled = !!(twitchClientId && twitchClientSecret);

export const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? "";
export const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
export const spotifyEnabled = !!(spotifyClientId && spotifyClientSecret);

export const spotifyRedirectUri = (
	process.env.SPOTIFY_REDIRECT_URI ?? `${publicUrl}/auth/spotify/callback`
).replace(/\/$/, "");

export const spotifyLinkingOpen = /^(1|true|yes|on)$/i.test(process.env.SPOTIFY_OPEN_LINKING ?? "");

export const spotifyPollMs = Number(process.env.SPOTIFY_POLL_MS ?? 5000);
export const spotifyIdlePollMs = Number(process.env.SPOTIFY_IDLE_POLL_MS ?? 15000);

/**
 * Twitch user ids, as strings. They are numeric but treated as opaque text
 * everywhere so nothing ever round-trips one through a JSON number.
 */
export const admins = new Set<string>(
	(process.env.ADMIN_TWITCH_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
);

export const cookieSecret = process.env.COOKIE_SECRET ?? randomBytes(32).toString("hex");
export const cookieSecure = publicUrl.startsWith("https://");
export const sessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

if (!process.env.COOKIE_SECRET) {
	console.warn("COOKIE_SECRET unset — every restart signs everyone out.");
}
if (!authEnabled) {
	console.warn("TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET unset — sign-in is disabled.");
}
if (!spotifyEnabled) {
	console.warn("SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET unset — Spotify is offered as unavailable.");
} else if (!spotifyLinkingOpen) {
	console.warn("SPOTIFY_OPEN_LINKING unset — only admins and already-linked accounts can link Spotify.");
}
