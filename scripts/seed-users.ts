import Database from "better-sqlite3";
import { DEFAULT_SETTINGS } from "../src/contract.js";
import { issueKeys, saveSettings, setProvider, setSetupDone, upsertUser } from "../src/db.js";
import { overlayUrlFor } from "../src/routes/account.js";
import { seal } from "../src/secrets.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
	const at = args.indexOf(name);
	return at === -1 ? null : args[at + 1] ?? null;
};

const FAKE_PREFIX = "fake-";
const dbPath = process.env.DB_PATH ?? "./data/app.db";
const db = new Database(dbPath);

const count = Math.max(1, Number(value("--count") ?? 1));
const withSpotify = flag("--spotify");

if (flag("--clean")) {
	const removed = db.prepare(`DELETE FROM users WHERE twitch_id LIKE '${FAKE_PREFIX}%'`).run();
	console.log(`removed ${removed.changes} fake user(s) from ${dbPath}`);
	db.close();
	process.exit(0);
}

const NAMES = [
	"PixelPuma", "NeonKestrel", "LoFiLantern", "QuietRiotGirl", "BassCadet",
	"MidnightMochi", "VelvetStatic", "GlitchGarden", "TapeDeckTilly", "AmberWaveform",
];

const MODES = ["default", "compact", "cover"];
const ACCENTS = ["#ff2d55", "#5ac8fa", "#34c759", "#ffd60a", "#bf5af2"];
const DAY_MS = 24 * 60 * 60 * 1000;

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;
const chance = (p: number) => Math.random() < p;

const backdate = db.prepare("UPDATE users SET created_at = ?, last_login_at = ? WHERE id = ?");
const markSeen = db.prepare("UPDATE user_keys SET last_seen_at = ?, overlay_seen_at = ? WHERE user_id = ?");
const linkSpotify = db.prepare(
	`INSERT INTO spotify_accounts (user_id, spotify_id, display_name, access_token, refresh_token, expires_at, linked_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const markSpotifyLinked = db.prepare("UPDATE users SET spotify_linked_at = ? WHERE id = ?");

const now = Date.now();
const made: Array<Record<string, string>> = [];

for (let i = 0; i < count; i++) {
	const suffix = Math.random().toString(36).slice(2, 7);
	const displayName = `${pick(NAMES)}${Math.floor(Math.random() * 90 + 10)}`;
	const createdAt = now - Math.floor(Math.random() * 30 * DAY_MS);
	const lastLoginAt = createdAt + Math.floor(Math.random() * (now - createdAt));

	const user = upsertUser({
		twitchId: `${FAKE_PREFIX}${suffix}`,
		login: displayName.toLowerCase(),
		displayName,
		avatarUrl: null,
	});
	backdate.run(createdAt, lastLoginAt, user.id);

	const spotify = withSpotify && chance(0.5);
	const pickedSource = spotify || chance(0.85);
	const setupDone = pickedSource && chance(0.8);

	if (pickedSource) setProvider(user.id, spotify ? "spotify" : "youtube-music");
	if (setupDone) setSetupDone(user.id, true);

	const { readKey } = issueKeys(user.id);

	if (setupDone && chance(0.7)) {
		markSeen.run(
			now - Math.floor(Math.random() * 7 * DAY_MS),
			chance(0.8) ? now - Math.floor(Math.random() * 7 * DAY_MS) : null,
			user.id
		);
	}

	if (chance(0.6)) {
		saveSettings(user.id, {
			...DEFAULT_SETTINGS,
			mode: pick(MODES),
			accent: pick(ACCENTS),
			scale: 80 + Math.floor(Math.random() * 8) * 10,
			blur: chance(0.5),
			hideWhenPaused: chance(0.3),
		});
	}

	if (spotify) {
		const linkedAt = lastLoginAt;
		linkSpotify.run(
			user.id,
			`fake-spotify-${suffix}`,
			displayName,
			seal(`fake-access-${suffix}`),
			seal(`fake-refresh-${suffix}`),
			now - 60_000,
			linkedAt
		);
		markSpotifyLinked.run(linkedAt, user.id);
	}

	made.push({
		id: String(user.id),
		login: user.login,
		provider: pickedSource ? (spotify ? "spotify" : "youtube-music") : "—",
		setup: setupDone ? "done" : "pending",
		overlay: overlayUrlFor(readKey),
	});
}

console.table(made);
console.log(`\nseeded ${made.length} fake user(s) into ${dbPath}, remove them with: npm run seed -- --clean`);

db.close();
