import { spotifyEnabled, spotifyIdlePollMs, spotifyPollMs } from "./config.js";
import type { Snapshot } from "./contract.js";
import { markProducerSeen, spotifyForReadKey, unlinkSpotify } from "./db.js";
import { hubForWrite, readKeysWithClients } from "./hubs.js";
import { fetchPlayback, withFreshToken } from "./spotify.js";

const TICK_MS = 1000;
const RESYNC_MS = 10_000;
const DRIFT_S = 1.5;
const NOT_OURS_MS = 60_000;

type Logger = {
	info: (obj: object, msg: string) => void;
	warn: (obj: object, msg: string) => void;
};

let log: Logger = { info: () => {}, warn: () => {} };

type Tracked = {
	dueAt: number;
	sent: Snapshot | null;
	sentAt: number;
	said?: string;
};

const tracked = new Map<string, Tracked>();

function say(entry: Tracked, what: string, emit: () => void) {
	if (entry.said === what) return;
	entry.said = what;
	emit();
}

function shouldSend(previous: Snapshot | null, sentAt: number, next: Snapshot, now: number): boolean {
	if (!previous || previous.hasTrack !== next.hasTrack) return true;
	if (!previous.hasTrack || !next.hasTrack) return false;
	if (
		previous.title !== next.title ||
		previous.artist !== next.artist ||
		previous.thumbnail !== next.thumbnail ||
		previous.playing !== next.playing
	) {
		return true;
	}
	const extrapolated = previous.playing
		? previous.currentTime + (now - sentAt) / 1000
		: previous.currentTime;
	if (Math.abs(extrapolated - next.currentTime) > DRIFT_S) return true;
	return now - sentAt >= RESYNC_MS;
}

async function poll(readKey: string, entry: Tracked) {
	const link = spotifyForReadKey(readKey);
	if (!link) {
		say(entry, "no-link", () =>
			log.info({ key: readKey.slice(0, 6) }, "spotify: overlay has no linked account on this provider")
		);
		entry.dueAt = Date.now() + NOT_OURS_MS;
		return;
	}

	const fresh = await withFreshToken(link);
	if (!fresh) {
		log.warn({ userId: link.userId }, "spotify: refresh rejected, unlinking");
		unlinkSpotify(link.userId);
		entry.dueAt = Date.now() + NOT_OURS_MS;
		return;
	}

	const result = await fetchPlayback(fresh.accessToken);

	if (result.status === "revoked") {
		const retried = await withFreshToken({ ...fresh, expiresAt: 0 });
		if (!retried) {
			log.warn({ userId: fresh.userId }, "spotify: grant revoked, unlinking");
			unlinkSpotify(fresh.userId);
		}
		entry.dueAt = Date.now() + spotifyIdlePollMs;
		return;
	}
	if (result.status === "retry") {
		say(entry, result.reason, () =>
			log.warn({ userId: fresh.userId, reason: result.reason }, "spotify: playback unreadable")
		);
		entry.dueAt = Date.now() + result.retryMs;
		return;
	}

	const now = Date.now();
	const snapshot = result.snapshot;
	entry.dueAt = now + (snapshot.hasTrack && snapshot.playing ? spotifyPollMs : spotifyIdlePollMs);

	say(entry, snapshot.hasTrack ? "playing" : "silent", () =>
		log.info(
			{ userId: fresh.userId, ...(snapshot.hasTrack ? { title: snapshot.title } : {}) },
			snapshot.hasTrack ? "spotify: reading playback" : "spotify: reachable, nothing playing"
		)
	);

	const hub = hubForWrite(readKey);
	markProducerSeen(fresh.userId);

	if (!shouldSend(entry.sent, entry.sentAt, snapshot, now)) return;
	entry.sent = snapshot;
	entry.sentAt = now;
	hub.lastState = snapshot;
	hub.broadcast("state", JSON.stringify(snapshot));
}

let running = false;

async function tick() {
	if (running) return;
	running = true;
	try {
		const active = new Set(readKeysWithClients());
		for (const readKey of tracked.keys()) if (!active.has(readKey)) tracked.delete(readKey);

		const now = Date.now();
		const due: Array<[string, Tracked]> = [];
		for (const readKey of active) {
			let entry = tracked.get(readKey);
			if (!entry) tracked.set(readKey, (entry = { dueAt: 0, sent: null, sentAt: 0 }));
			if (entry.dueAt <= now) due.push([readKey, entry]);
		}

		await Promise.all(due.map(([readKey, entry]) => poll(readKey, entry).catch(() => {})));
	} finally {
		running = false;
	}
}

export function startSpotifyPoller(logger: Logger) {
	if (!spotifyEnabled) return;
	log = logger;
	setInterval(() => void tick(), TICK_MS).unref();
}
