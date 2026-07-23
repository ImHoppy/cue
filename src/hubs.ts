import { IDLE_SNAPSHOT, type Settings, type Snapshot } from "./contract.js";
import { loadSettingsByReadKey } from "./db.js";

export type Client = {
	send: (event: string, data: string) => void;
	/** Raw SSE write for the `:\n\n` heartbeat. */
	comment: () => void;
	close: () => void;
};

/** How long a hub keeps its state after the producer goes quiet. Must stay above the extension's resync interval. */
const TTL_MS = 60_000;
const SWEEP_MS = 10_000;
const HEARTBEAT_MS = 20_000;

class Hub {
	readonly clients = new Set<Client>();
	lastState: Snapshot | null = null;
	settings: Settings;
	lastWrite = Date.now();

	constructor(readKey: string) {
		this.settings = loadSettingsByReadKey(readKey);
	}

	add(client: Client) {
		this.clients.add(client);
		runtime.streamsOpened++;
		runtime.liveClients++;
		if (runtime.liveClients > runtime.peakClients) runtime.peakClients = runtime.liveClients;
		client.send("settings", JSON.stringify(this.settings));
		client.send("state", JSON.stringify(this.lastState ?? IDLE_SNAPSHOT));
	}

	remove(client: Client) {
		// Guarded by the delete result: a dropped hub closes its sockets, and the
		// resulting "close" events would otherwise decrement a second time.
		if (this.clients.delete(client)) runtime.liveClients--;
	}

	broadcast(event: string, data: string) {
		for (const c of this.clients) c.send(event, data);
	}
}

const hubs = new Map<string, Hub>();

/**
 * Counters since boot. Deliberately in memory and deliberately not persisted:
 * they describe this process, and a restart resetting them is the honest
 * reading rather than a loss.
 */
const runtime = {
	bootedAt: Date.now(),
	presenceMessages: 0,
	streamsOpened: 0,
	liveClients: 0,
	peakClients: 0,
};

export const countPresence = () => runtime.presenceMessages++;

/** For producers, which own the liveness clock. */
export function hubForWrite(readKey: string): Hub {
	let hub = hubs.get(readKey);
	if (!hub) hubs.set(readKey, (hub = new Hub(readKey)));
	hub.lastWrite = Date.now();
	return hub;
}

/** For subscribing overlays, which must not make a hub look alive. */
export function hubForRead(readKey: string): Hub {
	let hub = hubs.get(readKey);
	if (!hub) {
		hubs.set(readKey, (hub = new Hub(readKey)));
		// No producer yet, so the first sweep should treat it as stale.
		hub.lastWrite = 0;
	}
	return hub;
}

/**
 * Pushes a style change from the website to whatever OBS has open, without
 * marking the hub live — a slider drag is not a sign the music is playing.
 */
export function pushSettings(readKey: string, settings: Settings) {
	const hub = hubs.get(readKey);
	if (!hub) return;
	hub.settings = settings;
	hub.broadcast("settings", JSON.stringify(settings));
}

/** Drops a hub and disconnects its overlays — used when a read key rotates. */
export function dropHub(readKey: string) {
	const hub = hubs.get(readKey);
	if (!hub) return;
	for (const c of hub.clients) c.close();
	hubs.delete(readKey);
}

/** How many browser sources are currently attached — what lights the dashboard lamp. */
export const clientsFor = (readKey: string) => hubs.get(readKey)?.clients.size ?? 0;

export function hubStats() {
	const now = Date.now();
	let clients = 0;
	let producing = 0;
	let playing = 0;
	for (const hub of hubs.values()) {
		clients += hub.clients.size;
		if (now - hub.lastWrite <= TTL_MS) producing++;
		if (hub.lastState?.hasTrack && hub.lastState.playing) playing++;
	}

	return {
		hubs: hubs.size,
		/** Browser sources attached right now. */
		clients,
		/** Streamers whose extension has reported inside the TTL. */
		producing,
		/** Of those, how many have a track actually rolling. */
		playing,
		peakClients: runtime.peakClients,
		presenceMessages: runtime.presenceMessages,
		streamsOpened: runtime.streamsOpened,
		uptimeMs: now - runtime.bootedAt,
	};
}

/** Clears stale state so an abandoned overlay goes blank instead of freezing on the last track. */
function sweep() {
	const now = Date.now();
	for (const [readKey, hub] of hubs) {
		if (now - hub.lastWrite <= TTL_MS) continue;
		if (hub.lastState !== null) {
			hub.lastState = null;
			hub.broadcast("state", JSON.stringify(IDLE_SNAPSHOT));
		}
		if (hub.clients.size === 0) hubs.delete(readKey);
	}
}

function heartbeat() {
	for (const hub of hubs.values()) for (const c of hub.clients) c.comment();
}

export function startHubTimers() {
	setInterval(sweep, SWEEP_MS).unref();
	setInterval(heartbeat, HEARTBEAT_MS).unref();
}

export type { Hub };
