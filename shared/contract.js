export const MODES = ["default", "compact", "cover"];

export const PROVIDERS = [
	{
		id: "youtube-music",
		name: "YouTube Music",
		tagline: "Reads the tab you already have open.",
		how: "A browser extension watches music.youtube.com and sends the track to your overlay.",
		available: true,
	},
	{
		id: "spotify",
		name: "Spotify",
		tagline: "Connects to your Spotify account.",
		how: "Sign in once and the server polls your playback — no extension, works with the desktop app.",
		available: false,
	},
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

export const BROWSERS = [
	{
		id: "chrome",
		name: "Chrome, Edge, Brave, Opera",
		engine: "Chromium",
		note: "One build covers every Chromium browser.",
		steps: [
			"Unzip the download somewhere you will not delete by accident.",
			"Open chrome://extensions (edge://extensions on Edge, brave://extensions on Brave).",
			"Turn on Developer mode, top right.",
			"Click Load unpacked and pick the unzipped folder.",
		],
	},
	{
		id: "firefox",
		name: "Firefox",
		engine: "Gecko",
		note: "Loads as a temporary add-on until it is signed, so repeat this after a restart.",
		steps: [
			"Open about:debugging#/runtime/this-firefox.",
			"Click Load Temporary Add-on.",
			"Pick the manifest.json inside the unzipped folder.",
		],
	},
];

/**
 * Style controls, in display order. `type` picks the widget, `showIf` hides a
 * control until its parent is on. `group` starts a new titled block.
 */
export const SETTING_FIELDS = [
	{ key: "mode", type: "select", label: "Layout", group: "Shape", default: "default",
		options: [
			{ value: "default", label: "Card" },
			{ value: "compact", label: "Single line" },
			{ value: "cover", label: "Cover art" },
		] },
	{ key: "coverSize", type: "range", label: "Cover size", default: 200, min: 120, max: 360, step: 4, unit: "px",
		showIf: (s) => s.mode === "cover" },
	{ key: "scale", type: "range", label: "Size", default: 100, min: 60, max: 180, step: 1, unit: "%" },
	{ key: "radius", type: "range", label: "Corner radius", default: 12, min: 0, max: 30, step: 1, unit: "px" },

	{ key: "accent", type: "color", label: "Accent", group: "Color", default: "#ff2d55" },
	{ key: "textColor", type: "color", label: "Text", default: "#ffffff" },
	{ key: "bgColor", type: "color", label: "Background", default: "#121216" },
	{ key: "opacity", type: "range", label: "Background opacity", default: 82, min: 0, max: 100, step: 1, unit: "%" },

	{ key: "blur", type: "toggle", label: "Blur the album art behind the card", group: "Backdrop", default: false },
	{ key: "blurAmount", type: "range", label: "Blur amount", default: 26, min: 0, max: 50, step: 1, unit: "px",
		showIf: (s) => s.blur },
	{ key: "blurDark", type: "range", label: "Darkness", default: 50, min: 0, max: 90, step: 1, unit: "%",
		showIf: (s) => s.blur },

	{ key: "showProgress", type: "toggle", label: "Show the progress bar", group: "Behavior", default: true },
	{ key: "hideWhenPaused", type: "toggle", label: "Hide the card while paused", default: false },
];

export const DEFAULT_SETTINGS = Object.freeze(
	Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, f.default]))
);

export const IDLE_SNAPSHOT = Object.freeze({ hasTrack: false, playing: false });

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isHex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());

/**
 * Coerces anything into a complete, in-range settings object. Never throws,
 * which is what lets the server validate settings by normalizing them rather
 * than keeping a second schema in step with this file.
 *
 * @param {any} raw
 * @returns {Record<string, string | number | boolean>}
 */
export function normalizeSettings(raw) {
	const input = raw && typeof raw === "object" ? migrateSettings({ ...raw }) : {};
	/** @type {Record<string, string | number | boolean>} */
	const out = {};
	for (const f of SETTING_FIELDS) {
		const v = input[f.key];
		if (f.type === "color") out[f.key] = isHex(v) ? v.trim().toLowerCase() : f.default;
		else if (f.type === "toggle") out[f.key] = typeof v === "boolean" ? v : f.default;
		else if (f.type === "select") out[f.key] = f.options.some((o) => o.value === v) ? v : f.default;
		else out[f.key] = typeof v === "number" && Number.isFinite(v) ? clamp(v, f.min, f.max) : f.default;
	}
	return out;
}

/** Reads settings saved before a field was renamed. */
export function migrateSettings(s) {
	if (s.mode === undefined && typeof s.compact === "boolean") s.mode = s.compact ? "compact" : "default";
	delete s.compact;
	return s;
}

/** True when a field's parent control is on, so the editor can hide it. */
export const fieldVisible = (field, settings) => !field.showIf || !!field.showIf(settings);

/** Formats a value the way its control's readout should show it. */
export const formatValue = (field, value) => (field.unit ? `${value}${field.unit}` : String(value));

/** Shows enough of a key to recognize it without handing it over. */
export function maskKey(prefix, length = 32) {
	if (!prefix) return "";
	return `${prefix}${"•".repeat(Math.max(4, length - prefix.length))}`;
}
