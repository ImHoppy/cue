export const MODES = ["default", "compact", "cover"];

export const ALIGNS = ["left", "center", "right"];

/**
 * Where the music comes from. `extension` providers push presence with a write
 * key; `account` providers are polled by the server from a linked account, so
 * setup asks for a sign-in instead of a key.
 */
export const PROVIDERS = [
	{
		id: "youtube-music",
		nameKey: "provider.youtube-music.name",
		taglineKey: "provider.youtube-music.tagline",
		howKey: "provider.youtube-music.how",
		transport: "extension",
		available: true,
	},
	{
		id: "spotify",
		nameKey: "provider.spotify.name",
		taglineKey: "provider.spotify.tagline",
		howKey: "provider.spotify.how",
		transport: "account",
		available: true,
	},
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

export const BROWSERS = [
	{
		id: "chrome",
		nameKey: "browser.chrome.name",
		engine: "Chromium",
		noteKey: "browser.chrome.note",
		stepKeys: [
			"browser.chrome.step.1",
			"browser.chrome.step.2",
			"browser.chrome.step.3",
			"browser.chrome.step.4",
		],
	},
	{
		id: "firefox",
		nameKey: "browser.firefox.name",
		engine: "Gecko",
		noteKey: "browser.firefox.note",
		stepKeys: ["browser.firefox.step.1", "browser.firefox.step.2", "browser.firefox.step.3"],
	},
];

/**
 * Style controls, in display order. `type` picks the widget, `showIf` hides a
 * control until its parent is on. `groupKey` starts a new titled block.
 */
export const SETTING_FIELDS = [
	{ key: "mode", type: "select", labelKey: "field.mode", groupKey: "field.group.shape", default: "default",
		options: [
			{ value: "default", labelKey: "field.mode.default" },
			{ value: "compact", labelKey: "field.mode.compact" },
			{ value: "cover", labelKey: "field.mode.cover" },
		] },
	{ key: "coverSize", type: "range", labelKey: "field.coverSize", default: 200, min: 120, max: 360, step: 4, unit: "px",
		showIf: (s) => s.mode === "cover" },
	{ key: "align", type: "select", labelKey: "field.align", default: "left",
		options: [
			{ value: "left", labelKey: "field.align.left" },
			{ value: "center", labelKey: "field.align.center" },
			{ value: "right", labelKey: "field.align.right" },
		] },
	{ key: "scale", type: "range", labelKey: "field.scale", default: 100, min: 60, max: 180, step: 1, unit: "%" },
	{ key: "radius", type: "range", labelKey: "field.radius", default: 12, min: 0, max: 30, step: 1, unit: "px" },

	{ key: "accent", type: "color", labelKey: "field.accent", groupKey: "field.group.color", default: "#ff2d55" },
	{ key: "textColor", type: "color", labelKey: "field.textColor", default: "#ffffff" },
	{ key: "bgColor", type: "color", labelKey: "field.bgColor", default: "#121216" },
	{ key: "opacity", type: "range", labelKey: "field.opacity", default: 82, min: 0, max: 100, step: 1, unit: "%" },

	{ key: "blur", type: "toggle", labelKey: "field.blur", groupKey: "field.group.backdrop", default: false },
	{ key: "blurAmount", type: "range", labelKey: "field.blurAmount", default: 26, min: 0, max: 50, step: 1, unit: "px",
		showIf: (s) => s.blur },
	{ key: "blurDark", type: "range", labelKey: "field.blurDark", default: 50, min: 0, max: 90, step: 1, unit: "%",
		showIf: (s) => s.blur },

	{ key: "showProgress", type: "toggle", labelKey: "field.showProgress", groupKey: "field.group.behavior", default: true },
	{ key: "hideWhenPaused", type: "toggle", labelKey: "field.hideWhenPaused", default: false },
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
