import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "./contract.js";
import { seal, unseal } from "./secrets.js";

export type User = {
	id: number;
	twitch_id: string;
	login: string;
	display_name: string;
	avatar_url: string | null;
	provider: string | null;
	setup_done: number;
	created_at: number;
	last_login_at: number;
};

export type Keys = {
	user_id: number;
	write_key_prefix: string;
	read_key: string;
	created_at: number;
	rotated_at: number | null;
};

type SpotifyRow = {
	user_id: number;
	spotify_id: string;
	display_name: string | null;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	linked_at: number;
};

export type SpotifyLink = {
	userId: number;
	spotifyId: string;
	displayName: string | null;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
};

const dbPath = process.env.DB_PATH ?? "./data/app.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		twitch_id     TEXT    NOT NULL UNIQUE,
		login         TEXT    NOT NULL,
		display_name  TEXT    NOT NULL,
		avatar_url    TEXT,
		provider      TEXT,
		setup_done    INTEGER NOT NULL DEFAULT 0,
		created_at    INTEGER NOT NULL,
		last_login_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS user_keys (
		user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		write_key_hash   TEXT    NOT NULL UNIQUE,
		write_key_prefix TEXT    NOT NULL,
		read_key         TEXT    NOT NULL UNIQUE,
		created_at       INTEGER NOT NULL,
		rotated_at       INTEGER
	);
	CREATE TABLE IF NOT EXISTS user_settings (
		user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		json       TEXT    NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS spotify_accounts (
		user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		spotify_id    TEXT    NOT NULL,
		display_name  TEXT,
		access_token  TEXT    NOT NULL,
		refresh_token TEXT    NOT NULL,
		expires_at    INTEGER NOT NULL,
		linked_at     INTEGER NOT NULL
	);
`);

/** Adds a column to an existing table once, so deploys can roll forward in place. */
function addColumn(table: string, column: string, decl: string) {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// Proof that each half of the pair actually reached something, which is what
// separates "signed up" from "using it" on the admin page.
addColumn("user_keys", "last_seen_at", "INTEGER");
addColumn("user_keys", "overlay_seen_at", "INTEGER");

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const PREFIX_LEN = 6;

const userCols = "id, twitch_id, login, display_name, avatar_url, provider, setup_done, created_at, last_login_at";
const keyCols = "user_id, write_key_prefix, read_key, created_at, rotated_at";

const q = {
	userByTwitch: db.prepare<[string], User>(`SELECT ${userCols} FROM users WHERE twitch_id = ?`),
	userById: db.prepare<[number], User>(`SELECT ${userCols} FROM users WHERE id = ?`),
	insertUser: db.prepare(
		`INSERT INTO users (twitch_id, login, display_name, avatar_url, created_at, last_login_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	),
	touchUser: db.prepare(
		"UPDATE users SET login = ?, display_name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?"
	),
	setProvider: db.prepare("UPDATE users SET provider = ? WHERE id = ?"),
	setSetupDone: db.prepare("UPDATE users SET setup_done = ? WHERE id = ?"),
	listUsers: db.prepare<
		[],
		User & {
			read_key: string | null;
			last_seen_at: number | null;
			overlay_seen_at: number | null;
			spotify_linked: number;
		}
	>(
		`SELECT ${userCols.split(", ").map((c) => `u.${c}`).join(", ")},
		        k.read_key, k.last_seen_at, k.overlay_seen_at,
		        (s.user_id IS NOT NULL) AS spotify_linked
		 FROM users u
		 LEFT JOIN user_keys k ON k.user_id = u.id
		 LEFT JOIN spotify_accounts s ON s.user_id = u.id
		 ORDER BY u.last_login_at DESC`
	),

	keysByUser: db.prepare<[number], Keys>(`SELECT ${keyCols} FROM user_keys WHERE user_id = ?`),
	keysByWriteHash: db.prepare<[string], Keys>(`SELECT ${keyCols} FROM user_keys WHERE write_key_hash = ?`),
	keysByReadKey: db.prepare<[string], Keys>(`SELECT ${keyCols} FROM user_keys WHERE read_key = ?`),
	upsertKeys: db.prepare(
		`INSERT INTO user_keys (user_id, write_key_hash, write_key_prefix, read_key, created_at)
		 VALUES (@userId, @hash, @prefix, @readKey, @now)
		 ON CONFLICT(user_id) DO UPDATE SET
			write_key_hash = excluded.write_key_hash,
			write_key_prefix = excluded.write_key_prefix,
			rotated_at = excluded.created_at`
	),
	setReadKey: db.prepare("UPDATE user_keys SET read_key = ?, rotated_at = ? WHERE user_id = ?"),

	linkSpotify: db.prepare(
		`INSERT INTO spotify_accounts (user_id, spotify_id, display_name, access_token, refresh_token, expires_at, linked_at)
		 VALUES (@userId, @spotifyId, @displayName, @access, @refresh, @expiresAt, @now)
		 ON CONFLICT(user_id) DO UPDATE SET
			spotify_id = excluded.spotify_id,
			display_name = excluded.display_name,
			access_token = excluded.access_token,
			refresh_token = excluded.refresh_token,
			expires_at = excluded.expires_at,
			linked_at = excluded.linked_at`
	),
	updateSpotifyTokens: db.prepare(
		"UPDATE spotify_accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?"
	),
	unlinkSpotify: db.prepare("DELETE FROM spotify_accounts WHERE user_id = ?"),
	spotifyByUser: db.prepare<[number], SpotifyRow>("SELECT * FROM spotify_accounts WHERE user_id = ?"),
	spotifyByReadKey: db.prepare<[string], SpotifyRow & { provider: string | null }>(
		`SELECT s.*, u.provider
		 FROM user_keys k
		 JOIN users u ON u.id = k.user_id
		 JOIN spotify_accounts s ON s.user_id = k.user_id
		 WHERE k.read_key = ?`
	),

	getSettings: db.prepare<[number], { json: string }>("SELECT json FROM user_settings WHERE user_id = ?"),
	putSettings: db.prepare(
		`INSERT INTO user_settings (user_id, json, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
	),
};

/** Creates the account on first sign-in, refreshes the profile on every later one. */
export function upsertUser(profile: {
	twitchId: string;
	login: string;
	displayName: string;
	avatarUrl: string | null;
}): User {
	const now = Date.now();
	const existing = q.userByTwitch.get(profile.twitchId);
	if (existing) {
		q.touchUser.run(profile.login, profile.displayName, profile.avatarUrl, now, existing.id);
		return q.userById.get(existing.id)!;
	}
	const info = q.insertUser.run(
		profile.twitchId,
		profile.login,
		profile.displayName,
		profile.avatarUrl,
		now,
		now
	);
	// No key yet, deliberately. Minting one here would mean setup opens on a key
	// that exists but can never be shown — only its hash is kept — so the first
	// thing anyone sees is a value they cannot copy. It is issued instead at the
	// step that needs it, where it can be displayed once and copied.
	return q.userById.get(Number(info.lastInsertRowid))!;
}

export const getUser = (id: number) => q.userById.get(id) ?? null;
export const listUsers = () => q.listUsers.all();

export function setProvider(userId: number, provider: string) {
	q.setProvider.run(provider, userId);
}

export function setSetupDone(userId: number, done: boolean) {
	q.setSetupDone.run(done ? 1 : 0, userId);
}

export function issueKeys(userId: number): { writeKey: string; readKey: string } {
	const existing = q.keysByUser.get(userId);
	const writeKey = token();
	const readKey = existing?.read_key ?? token();
	q.upsertKeys.run({
		userId,
		hash: hash(writeKey),
		prefix: writeKey.slice(0, PREFIX_LEN),
		readKey,
		now: Date.now(),
	});
	return { writeKey, readKey };
}

export function ensureKeys(userId: number): Keys {
	const existing = q.keysByUser.get(userId);
	if (existing) return existing;
	issueKeys(userId);
	return q.keysByUser.get(userId)!;
}

export function rotateReadKey(userId: number): string | null {
	if (!q.keysByUser.get(userId)) return null;
	const next = token();
	q.setReadKey.run(next, Date.now(), userId);
	return next;
}

export const keysForUser = (userId: number) => q.keysByUser.get(userId) ?? null;

/** Resolves a presented write key to its owner, or null if it is not a live key. */
export function resolveWriteKey(writeKey: string): Keys | null {
	return q.keysByWriteHash.get(hash(writeKey)) ?? null;
}

export const userIdForReadKey = (readKey: string) => q.keysByReadKey.get(readKey)?.user_id ?? null;
export const readKeyIsLive = (readKey: string) => !!q.keysByReadKey.get(readKey);

function toLink(row: SpotifyRow | undefined): SpotifyLink | null {
	if (!row) return null;
	const accessToken = unseal(row.access_token);
	const refreshToken = unseal(row.refresh_token);
	if (!accessToken || !refreshToken) {
		q.unlinkSpotify.run(row.user_id);
		return null;
	}
	return {
		userId: row.user_id,
		spotifyId: row.spotify_id,
		displayName: row.display_name,
		accessToken,
		refreshToken,
		expiresAt: row.expires_at,
	};
}

export function linkSpotify(link: {
	userId: number;
	spotifyId: string;
	displayName: string | null;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}) {
	q.linkSpotify.run({
		userId: link.userId,
		spotifyId: link.spotifyId,
		displayName: link.displayName,
		access: seal(link.accessToken),
		refresh: seal(link.refreshToken),
		expiresAt: link.expiresAt,
		now: Date.now(),
	});
}

export function updateSpotifyTokens(userId: number, accessToken: string, refreshToken: string, expiresAt: number) {
	q.updateSpotifyTokens.run(seal(accessToken), seal(refreshToken), expiresAt, userId);
}

export const unlinkSpotify = (userId: number) => void q.unlinkSpotify.run(userId);

export const spotifyForUser = (userId: number) => toLink(q.spotifyByUser.get(userId));

export function spotifyForReadKey(readKey: string): SpotifyLink | null {
	const row = q.spotifyByReadKey.get(readKey);
	if (!row || row.provider !== "spotify") return null;
	return toLink(row);
}

export function loadSettings(userId: number): Settings {
	const row = q.getSettings.get(userId);
	if (!row) return { ...DEFAULT_SETTINGS };
	try {
		return normalizeSettings(JSON.parse(row.json));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(userId: number, settings: Settings): Settings {
	const clean = normalizeSettings(settings);
	q.putSettings.run(userId, JSON.stringify(clean), Date.now());
	return clean;
}

export function loadSettingsByReadKey(readKey: string): Settings {
	const userId = userIdForReadKey(readKey);
	return userId === null ? { ...DEFAULT_SETTINGS } : loadSettings(userId);
}

// ---- usage marks

const SEEN_THROTTLE_MS = 5 * 60 * 1000;
const seenCache = new Map<string, number>();

function markSeen(column: "last_seen_at" | "overlay_seen_at", where: "user_id" | "read_key", value: number | string) {
	const cacheKey = `${column}:${value}`;
	const now = Date.now();
	const previous = seenCache.get(cacheKey) ?? 0;
	if (now - previous < SEEN_THROTTLE_MS) return;
	seenCache.set(cacheKey, now);
	db.prepare(`UPDATE user_keys SET ${column} = ? WHERE ${where} = ?`).run(now, value);
}

/** The extension reached us */
export const markProducerSeen = (userId: number) => markSeen("last_seen_at", "user_id", userId);

/** A browser source attached */
export const markOverlaySeen = (readKey: string) => markSeen("overlay_seen_at", "read_key", readKey);

// ---- statistics

export type Stats = ReturnType<typeof collectStats>;

const DAY_MS = 24 * 60 * 60 * 1000;
const countOf = (sql: string, ...params: unknown[]) =>
	(db.prepare(sql).get(...(params as [])) as { n: number }).n;

export function collectStats(days = 30) {
	const now = Date.now();
	const since = now - days * DAY_MS;

	const signupRows = db
		.prepare<[number], { day: string; n: number }>(
			`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
			 FROM users WHERE created_at >= ? GROUP BY day`
		)
		.all(since);
	const byDay = new Map(signupRows.map((r) => [r.day, r.n]));

	// Zero-filled, so a quiet week reads as a gap rather than disappearing.
	const signups: Array<{ day: string; count: number }> = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
		signups.push({ day, count: byDay.get(day) ?? 0 });
	}

	const settingsRows = db.prepare<[], { json: string }>("SELECT json FROM user_settings").all();
	const totalUsers = countOf("SELECT COUNT(*) AS n FROM users");
	const styled = settingsRows.length;

	const modes = new Map<string, number>();
	const toggles = { blur: 0, hideProgress: 0, hideWhenPaused: 0 };
	for (const row of settingsRows) {
		let s: Settings;
		try {
			s = normalizeSettings(JSON.parse(row.json));
		} catch {
			s = { ...DEFAULT_SETTINGS };
		}
		modes.set(String(s.mode), (modes.get(String(s.mode)) ?? 0) + 1);
		if (s.blur) toggles.blur++;
		if (!s.showProgress) toggles.hideProgress++;
		if (s.hideWhenPaused) toggles.hideWhenPaused++;
	}
	// Everyone who never opened the editor is running the defaults.
	const untouched = totalUsers - styled;
	if (untouched > 0) {
		const mode = String(DEFAULT_SETTINGS.mode);
		modes.set(mode, (modes.get(mode) ?? 0) + untouched);
		if (DEFAULT_SETTINGS.blur) toggles.blur += untouched;
		if (!DEFAULT_SETTINGS.showProgress) toggles.hideProgress += untouched;
		if (DEFAULT_SETTINGS.hideWhenPaused) toggles.hideWhenPaused += untouched;
	}

	return {
		totals: {
			users: totalUsers,
			styled,
			providers: db
				.prepare<[], { provider: string | null; n: number }>(
					"SELECT provider, COUNT(*) AS n FROM users GROUP BY provider"
				)
				.all()
				.map((r) => ({ provider: r.provider ?? "none", count: r.n })),
			spotifyLinked: countOf("SELECT COUNT(*) AS n FROM spotify_accounts"),
			spotifyPicked: countOf("SELECT COUNT(*) AS n FROM users WHERE provider = 'spotify'"),
		},
		activity: {
			new7d: countOf("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", now - 7 * DAY_MS),
			// The week before last, so the signups tile can carry a delta.
			prev7d: countOf(
				"SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?",
				now - 14 * DAY_MS,
				now - 7 * DAY_MS
			),
			new30d: countOf("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", now - 30 * DAY_MS),
			playing24h: countOf("SELECT COUNT(*) AS n FROM user_keys WHERE last_seen_at >= ?", now - DAY_MS),
			playing7d: countOf("SELECT COUNT(*) AS n FROM user_keys WHERE last_seen_at >= ?", now - 7 * DAY_MS),
			signedIn7d: countOf("SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ?", now - 7 * DAY_MS),
		},
		// Ordered as the wizard presents them, so a drop between two rows is the
		// step people are giving up on.
		funnel: [
			{ id: "signed_in", count: totalUsers },
			{ id: "picked_source", count: countOf("SELECT COUNT(*) AS n FROM users WHERE provider IS NOT NULL") },
			{ id: "setup_done", count: countOf("SELECT COUNT(*) AS n FROM users WHERE setup_done = 1") },
			{ id: "extension_track", count: countOf("SELECT COUNT(*) AS n FROM user_keys WHERE last_seen_at IS NOT NULL") },
			{ id: "overlay_opened", count: countOf("SELECT COUNT(*) AS n FROM user_keys WHERE overlay_seen_at IS NOT NULL") },
		],
		signups,
		style: {
			modes: [...modes].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count),
			toggles: [
				{ id: "blur", count: toggles.blur },
				{ id: "hide_progress", count: toggles.hideProgress },
				{ id: "hide_when_paused", count: toggles.hideWhenPaused },
			],
		},
	};
}
