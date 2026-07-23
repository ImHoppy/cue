/**
 * The popup: connect the extension, and style the overlay.
 *
 * The style controls and the preview card are the same modules the website
 * mounts — shared/style-editor.js and shared/overlay-core.js — so the popup
 * cannot drift out of step with the dashboard, and a new setting appears in
 * both from one edit to shared/contract.js.
 */
import { createOverlay } from "./shared/overlay-core.js";
import { createFakePlayer } from "./shared/fake-player.js";
import { createStyleEditor } from "./shared/style-editor.js";
import { DEFAULT_SETTINGS } from "./shared/contract.js";
import { DEFAULT_SERVER } from "./config.generated.js";

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const $ = (id) => document.getElementById(id);
const dot = $("dot");
const state = $("state");
const msg = $("msg");
// The server is fixed at build time — shown so it is obvious where a key is
// going, but there is nothing to configure. See background.js.
$("serverName").textContent = DEFAULT_SERVER.replace(/^https?:\/\//, "");
$("dashLink").href = `${DEFAULT_SERVER}/dashboard`;
const keyInput = $("writeKey");

let overlayUrl = "";

function say(text, bad = false) {
	msg.textContent = text;
	msg.classList.toggle("bad", bad);
}

// ---- preview ---------------------------------------------------------------

const overlay = createOverlay($("preview"), { initial: DEFAULT_SETTINGS });
const player = createFakePlayer({ onSnapshot: (s) => overlay.applySnapshot(s) });
player.start();

const editor = createStyleEditor($("editor"), {
	settings: DEFAULT_SETTINGS,
	showReset: true,
	onChange(settings) {
		overlay.applySettings(settings);
		browserAPI.runtime.sendMessage({ type: "SET_SETTINGS", payload: settings });
	},
});

// ---- status ----------------------------------------------------------------

function paintStatus(res) {
	if (!res) {
		dot.className = "dot off";
		state.textContent = "extension not running";
		return;
	}
	const connected = res.connected === true;
	dot.className = "dot " + (res.connected === null ? "" : connected ? "on" : "off");
	state.textContent = connected
		? res.lastSnapshot?.hasTrack
			? `sending · ${res.lastSnapshot.title}`
			: "connected · nothing playing"
		: res.hasKey
			? res.lastError || "not connected"
			: "no key yet";

	overlayUrl = res.overlayUrl || "";
	$("overlaySection").hidden = !overlayUrl;

	editor.setSettings(res.settings || DEFAULT_SETTINGS);
	overlay.applySettings(res.settings || DEFAULT_SETTINGS);

	// A real track beats the fake one — if music is playing, show that instead.
	if (res.lastSnapshot?.hasTrack) {
		player.stop();
		overlay.applySnapshot(res.lastSnapshot);
		$("previewNote").textContent = "Showing what your overlay is showing.";
	}
}

function refresh() {
	browserAPI.runtime.sendMessage({ type: "GET_STATUS" }, paintStatus);
}

// ---- actions ---------------------------------------------------------------

$("save").addEventListener("click", () => {
	const key = keyInput.value.trim();
	if (!key) return say("Paste the key from your dashboard first.", true);
	browserAPI.runtime.sendMessage({ type: "SET_KEY", payload: { writeKey: key } });
	say("Connecting…");
	keyInput.value = "";
	setTimeout(() => {
		refresh();
		say("");
	}, 900);
});

$("copyUrl").addEventListener("click", async () => {
	try {
		await navigator.clipboard.writeText(overlayUrl);
		$("copyUrl").textContent = "Copied — paste it into a Browser Source";
		setTimeout(() => ($("copyUrl").textContent = "Copy overlay URL for OBS"), 1800);
	} catch {
		say("Your browser blocked the clipboard. Copy the URL from your dashboard.", true);
	}
});

refresh();
