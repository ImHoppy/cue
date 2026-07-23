/**
 * The OBS browser source. Transport only — everything drawn lives in
 * shared/overlay-core.js, which the website preview mounts too.
 *
 * EventSource is used rather than a WebSocket because the overlay only ever
 * receives, and because it reconnects on its own: there is no retry loop here
 * to get wrong, and OBS's "Refresh browser source" replays the last state from
 * the server immediately.
 */
import { createOverlay, settingsFromParams } from "/shared/overlay-core.js";

const params = new URLSearchParams(location.search);
const key = params.get("key");

const { seed, forced } = settingsFromParams(params);
const overlay = createOverlay(document.getElementById("overlay"), {
	forced,
	initial: seed,
	hideWhenIdle: params.get("hideWhenIdle") !== "0",
});

if (!key) {
	console.error("[overlay] no ?key= in the URL — copy the overlay URL from your dashboard.");
} else {
	const es = new EventSource(`/api/stream?key=${encodeURIComponent(key)}`);
	const on = (name, fn) =>
		es.addEventListener(name, (ev) => {
			try {
				fn(JSON.parse(ev.data));
			} catch {}
		});
	on("state", (s) => overlay.applySnapshot(s));
	on("settings", (s) => overlay.applySettings(s));
}
