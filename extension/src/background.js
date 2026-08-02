/**
 * Relays what the content script scrapes to the Cue server.
 *
 * Plain POSTs rather than a socket: the scraper sends anchors, not a position
 * stream, so this is about six requests a minute in steady state and a socket
 * would be more moving parts than that traffic deserves. It also means the
 * service worker can go to sleep between tracks without dropping a connection.
 */
import { DEFAULT_SETTINGS, normalizeSettings } from "./shared/contract.js";
import { DEFAULT_SERVER, EXTENSION_TARGET } from "./config.generated.js";

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

/**
 * Fixed at build time, not configurable.
 *
 * The origin also has to appear in the manifest's host_permissions, and an
 * extension cannot add one at runtime — so a server field could only ever be
 * set to something the extension has no permission to reach. Point a build at
 * another instance with `node extension/build.mjs --server <url>` instead.
 */
const serverUrl = DEFAULT_SERVER;

let writeKey = "";
let settings = { ...DEFAULT_SETTINGS };
let lastSnapshot = { hasTrack: false, playing: false };

/** null until the first request settles, so the popup can say "not tried yet". */
let connected = null;
let lastError = null;
/** Public half of the pair, learned from the server so the popup can show the OBS URL. */
let overlayUrl = "";

const currentVersion = browserAPI.runtime.getManifest().version;
const downloadUrl = `${serverUrl}/downloads/${EXTENSION_TARGET}`;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

let latestVersion = "";
let dismissedVersion = "";
let lastUpdateCheck = 0;

async function loadConfig() {
	try {
		const stored = await browserAPI.storage.local.get([
			"writeKey",
			"overlaySettings",
			"overlayUrl",
			"latestVersion",
			"dismissedVersion",
			"lastUpdateCheck",
		]);
		writeKey = stored.writeKey || "";
		overlayUrl = stored.overlayUrl || "";
		settings = normalizeSettings(stored.overlaySettings);
		latestVersion = stored.latestVersion || "";
		dismissedVersion = stored.dismissedVersion || "";
		lastUpdateCheck = stored.lastUpdateCheck || 0;
	} catch {
		settings = { ...DEFAULT_SETTINGS };
	}
}

const parts = (v) => String(v).split(".").map(Number);

function isNewer(a, b) {
	if (!/^\d+(\.\d+){0,3}$/.test(String(a)) || !/^\d+(\.\d+){0,3}$/.test(String(b))) return false;
	const left = parts(a);
	const right = parts(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] || 0) - (right[i] || 0);
		if (diff !== 0) return diff > 0;
	}
	return false;
}

const updatePending = () => isNewer(latestVersion, currentVersion) && latestVersion !== dismissedVersion;

async function paintBadge() {
	try {
		const pending = updatePending();
		await browserAPI.action.setBadgeText({ text: pending ? "•" : "" });
		if (pending) await browserAPI.action.setBadgeBackgroundColor({ color: "#ffae3b" });
	} catch {}
}

async function checkForUpdate(force = false) {
	await ready;
	if (!force && Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
	lastUpdateCheck = Date.now();
	try {
		const res = await fetch(`${serverUrl}/api/extension/version`);
		if (res.ok) {
			const found = (await res.json())?.versions?.[EXTENSION_TARGET];
			if (typeof found === "string" && /^\d+(\.\d+){0,3}$/.test(found)) latestVersion = found;
		}
	} catch {}
	try {
		await browserAPI.storage.local.set({ latestVersion, lastUpdateCheck });
	} catch {}
	paintBadge();
}

const httpError = (status) =>
	status === 401 ? { code: "key_rejected" } : { code: "server_said", status };

async function post(type, payload) {
	if (!writeKey) {
		connected = false;
		lastError = { code: "no_key" };
		return;
	}
	try {
		const res = await fetch(`${serverUrl}/api/presence`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${writeKey}` },
			body: JSON.stringify({ type, payload }),
		});
		connected = res.ok;
		lastError = res.ok ? null : httpError(res.status);
	} catch {
		connected = false;
		lastError = { code: "unreachable" };
	}
}

/**
 * Adopts the style saved on the account instead of pushing this install's
 * defaults over it — otherwise setting up a second machine would silently
 * restyle the overlay.
 */
async function pullAccount() {
	if (!writeKey) {
		connected = false;
		lastError = { code: "no_key" };
		return;
	}
	try {
		const res = await fetch(`${serverUrl}/api/settings`, {
			headers: { authorization: `Bearer ${writeKey}` },
		});
		if (!res.ok) {
			connected = false;
			lastError = httpError(res.status);
			return;
		}
		const body = await res.json();
		settings = normalizeSettings(body.settings);
		overlayUrl = body.overlayUrl || "";
		await browserAPI.storage.local.set({ overlaySettings: settings, overlayUrl });
		connected = true;
		lastError = null;
	} catch {
		connected = false;
		lastError = { code: "unreachable" };
	}
}

browserAPI.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (!msg) return;

	if (msg.type === "NOW_PLAYING") {
		lastSnapshot = msg.payload;
		post("NOW_PLAYING", lastSnapshot);
		return;
	}

	if (msg.type === "SET_SETTINGS") {
		settings = normalizeSettings(msg.payload);
		browserAPI.storage.local.set({ overlaySettings: settings });
		post("SETTINGS", settings);
		return;
	}

	if (msg.type === "SET_KEY") {
		writeKey = (msg.payload?.writeKey || "").trim();
		overlayUrl = "";
		browserAPI.storage.local.set({ writeKey, overlayUrl });
		connected = null;
		pullAccount().then(() => post("NOW_PLAYING", lastSnapshot));
		return;
	}

	if (msg.type === "GET_STATUS") {
		sendResponse({
			connected,
			lastError,
			serverUrl,
			overlayUrl,
			hasKey: !!writeKey,
			lastSnapshot,
			settings,
			update: {
				current: currentVersion,
				latest: latestVersion,
				pending: updatePending(),
				url: downloadUrl,
				target: EXTENSION_TARGET,
			},
		});
		return true;
	}

	if (msg.type === "DISMISS_UPDATE") {
		dismissedVersion = latestVersion;
		browserAPI.storage.local.set({ dismissedVersion });
		paintBadge();
		return;
	}
});

/**
 * Catches up the tabs that were already open.
 *
 * A manifest content script is only injected into pages that load after the
 * extension starts, so installing it while YouTube Music is already playing
 * leaves that tab with no scraper in it until it is reloaded — which looks
 * exactly like the extension not working. Injecting by hand closes the gap.
 *
 * Safe to land on a tab that already has the scraper: it guards against
 * re-entry and the second copy returns immediately.
 */
async function injectIntoOpenTabs() {
	try {
		const tabs = await browserAPI.tabs.query({ url: "*://music.youtube.com/*" });
		await Promise.all(
			tabs.map((tab) =>
				browserAPI.scripting
					.executeScript({ target: { tabId: tab.id }, files: ["scraper.js"] })
					// A tab can be discarded, or mid-navigation, or a page the browser
					// will not script. None of those are worth failing the rest over.
					.catch(() => {})
			)
		);
	} catch {}
}

// Fires on install, on update, and when an unpacked extension is reloaded.
browserAPI.runtime.onInstalled.addListener(() => {
	injectIntoOpenTabs();
	checkForUpdate(true);
});

// The worker is allowed to sleep; this only makes sure a long silence still
// re-checks the account rather than leaving the popup showing a stale state.
browserAPI.alarms.create("recheck", { periodInMinutes: 5 });
browserAPI.alarms.onAlarm.addListener(() => {
	if (connected === false) pullAccount();
	checkForUpdate();
});

const ready = loadConfig();

ready.then(() => {
	paintBadge();
	pullAccount();
	checkForUpdate();
});
