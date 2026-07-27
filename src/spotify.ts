import { isAdmin } from "./auth.js";
import { spotifyClientId, spotifyClientSecret, spotifyEnabled, spotifyLinkingOpen, spotifyRedirectUri } from "./config.js";
import type { Snapshot } from "./contract.js";
import { updateSpotifyTokens, type SpotifyLink, type User } from "./db.js";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const PLAYER = "https://api.spotify.com/v1/me/player/currently-playing";

export const SCOPES = "user-read-playback-state user-read-currently-playing";

export const canLinkSpotify = (user: User) =>
	spotifyEnabled && (spotifyLinkingOpen || isAdmin(user) || user.spotify_linked_at !== null);

export const spotifyLinkClosed = (user: User) => spotifyEnabled && !canLinkSpotify(user);

const basic = () => Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");

export function spotifyAuthorizeUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: spotifyClientId,
		response_type: "code",
		redirect_uri: spotifyRedirectUri,
		scope: SCOPES,
		state,
		show_dialog: "true",
	});
	return `${AUTHORIZE}?${params}`;
}

type TokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
};

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

export type TokenResult = { ok: true; tokens: Tokens } | { ok: false; detail: string };

async function postToken(body: URLSearchParams, fallbackRefresh?: string): Promise<TokenResult> {
	let res: Response;
	try {
		res = await fetch(TOKEN, {
			method: "POST",
			headers: {
				authorization: `Basic ${basic()}`,
				"content-type": "application/x-www-form-urlencoded",
			},
			body,
			signal: AbortSignal.timeout(8000),
		});
	} catch (err) {
		return { ok: false, detail: `token request failed: ${err}` };
	}
	if (!res.ok) {
		return { ok: false, detail: `token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}` };
	}
	const token = (await res.json()) as TokenResponse;
	const refreshToken = token.refresh_token ?? fallbackRefresh;
	if (!token.access_token || !refreshToken) {
		return { ok: false, detail: "token endpoint returned no usable token" };
	}
	return {
		ok: true,
		tokens: {
			accessToken: token.access_token,
			refreshToken,
			expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
		},
	};
}

export const exchangeCode = (code: string) =>
	postToken(
		new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: spotifyRedirectUri })
	);

export async function fetchProfile(accessToken: string) {
	try {
		const res = await fetch("https://api.spotify.com/v1/me", {
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) return null;
		const me = (await res.json()) as { id?: string; display_name?: string | null };
		return me.id ? { id: me.id, displayName: me.display_name || null } : null;
	} catch {
		return null;
	}
}

export async function withFreshToken(link: SpotifyLink): Promise<SpotifyLink | null> {
	if (link.expiresAt - Date.now() > 60_000) return link;
	const result = await postToken(
		new URLSearchParams({ grant_type: "refresh_token", refresh_token: link.refreshToken }),
		link.refreshToken
	);
	if (!result.ok) return null;
	const { tokens } = result;
	updateSpotifyTokens(link.userId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
	return { ...link, ...tokens };
}

type Image = { url?: string; width?: number | null };
type Artist = { name?: string };
type Item = {
	type?: string;
	name?: string;
	duration_ms?: number;
	artists?: Artist[];
	album?: { images?: Image[] };
	show?: { name?: string; images?: Image[] };
	images?: Image[];
};

function artwork(images: Image[] | undefined): string {
	const sized = (images ?? []).filter((i): i is Image & { url: string } => typeof i.url === "string");
	if (!sized.length) return "";
	const sorted = [...sized].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
	return (sorted.find((i) => (i.width ?? 0) <= 400) ?? sorted[sorted.length - 1]!).url;
}

const seconds = (ms: number | null | undefined) => Math.max(0, Math.min(86400, (ms ?? 0) / 1000));

function toSnapshot(body: { is_playing?: boolean; progress_ms?: number | null; item?: Item | null }): Snapshot {
	const item = body.item;
	if (!item?.name) return { hasTrack: false, playing: false };
	const isEpisode = item.type === "episode";
	return {
		hasTrack: true,
		playing: !!body.is_playing,
		title: item.name.slice(0, 300),
		artist: (isEpisode
			? (item.show?.name ?? "")
			: (item.artists ?? []).map((a) => a.name).filter(Boolean).join(", ")
		).slice(0, 300),
		thumbnail: artwork(isEpisode ? (item.images ?? item.show?.images) : item.album?.images),
		duration: seconds(item.duration_ms),
		currentTime: seconds(body.progress_ms),
	};
}

export type Playback =
	| { status: "ok"; snapshot: Snapshot }
	| { status: "revoked" }
	| { status: "retry"; retryMs: number; reason: string };

export async function fetchPlayback(accessToken: string): Promise<Playback> {
	let res: Response;
	try {
		res = await fetch(`${PLAYER}?additional_types=track,episode`, {
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(8000),
		});
	} catch (err) {
		return { status: "retry", retryMs: 10_000, reason: `unreachable: ${err}` };
	}

	if (res.status === 204) return { status: "ok", snapshot: { hasTrack: false, playing: false } };
	if (res.status === 401) return { status: "revoked" };
	if (res.status === 429) {
		const after = Number(res.headers.get("retry-after") ?? 5);
		return { status: "retry", retryMs: (Number.isFinite(after) ? after : 5) * 1000 + 1000, reason: "rate limited" };
	}
	if (!res.ok) {
		return { status: "retry", retryMs: 15_000, reason: `player ${res.status}: ${(await res.text()).slice(0, 200)}` };
	}

	try {
		return { status: "ok", snapshot: toSnapshot((await res.json()) as never) };
	} catch (err) {
		return { status: "retry", retryMs: 10_000, reason: `unreadable body: ${err}` };
	}
}
