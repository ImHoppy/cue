/**
 * The overlay card renderer, with no opinion about where its data comes from.
 */
import { ALIGNS, DEFAULT_SETTINGS, MODES, normalizeSettings } from "./contract.js";

const MARKUP = `
	<div class="card hidden" part="card">
		<div class="art-bg" data-art-bg></div>
		<div class="art-wrap">
			<img class="art" data-art alt="">
			<div class="pause-badge" aria-hidden="true"><span></span><span></span></div>
		</div>
		<div class="info">
			<div class="title" data-title><span class="scroll-inner"></span></div>
			<div class="artist" data-artist><span class="scroll-inner"></span></div>
			<div class="progress">
				<span class="time" data-elapsed>0:00</span>
				<div class="bar"><div class="fill" data-fill></div></div>
				<span class="time" data-duration>0:00</span>
			</div>
		</div>
	</div>
`;

/** Corrections smaller than this glide; anything larger is a seek and snaps. */
const EASE_MAX_S = 2;
const EASE_MS = 700;

const hexToRgb = (hex) => {
	const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

function fmt(sec) {
	const s = Math.max(0, Math.floor(sec || 0));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * @param {HTMLElement} host        element to render into; its contents are replaced
 * @param {object}      [opts]
 * @param {Set<string>} [opts.forced]        setting keys the URL pinned, which live settings must not override
 * @param {object}      [opts.initial]       starting settings; forced keys are pinned to these
 * @param {boolean}     [opts.hideWhenIdle]  default true; false keeps the card up with no track
 */
export function createOverlay(host, opts = {}) {
	const forced = opts.forced instanceof Set ? opts.forced : new Set();
	let hideWhenIdle = opts.hideWhenIdle !== false;

	host.classList.add("ytm-overlay");
	host.innerHTML = MARKUP;

	const q = (name) => host.querySelector(`[data-${name}]`);
	const card = host.querySelector(".card");
	const artBg = q("art-bg");
	const art = q("art");
	const titleEl = q("title");
	const artistEl = q("artist");
	const titleInner = titleEl.querySelector(".scroll-inner");
	const artistInner = artistEl.querySelector(".scroll-inner");
	const elapsedEl = q("elapsed");
	const durationEl = q("duration");
	const fill = q("fill");

	// Seeded before the first applySettings so pinning a forced key pins the
	// value the URL asked for, not the default it would otherwise land on.
	let settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(opts.initial || {}) });
	let current = null;
	let anchorPos = 0;
	let anchorClock = 0;
	let anchorTrack = "";
	let easeOffset = 0;
	let easeClock = 0;
	let raf = 0;

	function updateMarquee(box, inner) {
		const sig = `${inner.textContent}|${box.clientWidth}`;
		if (box.dataset.mqSig === sig) return;
		box.dataset.mqSig = sig;
		box.classList.remove("scrolling");
		const over = box.scrollWidth - box.clientWidth;
		if (over > 2) {
			box.style.setProperty("--marquee-shift", `-${over + 4}px`);
			box.style.setProperty("--marquee-dur", `${Math.max(6, (over + 4) / 12 + 4)}s`);
			box.classList.add("scrolling");
		}
	}

	function render() {
		const s = current;
		if (!s || !s.hasTrack) {
			if (hideWhenIdle) card.classList.add("hidden");
			return;
		}
		if (settings.hideWhenPaused && !s.playing) {
			card.classList.add("hidden");
			return;
		}
		card.classList.remove("hidden");
		card.classList.toggle("paused", !s.playing);
		card.classList.toggle("no-artist", !s.artist);

		titleInner.textContent = s.title || "—";
		titleEl.title = s.title || "";
		artistInner.textContent = s.artist || "";
		artistEl.title = s.artist || "";

		if (s.thumbnail && art.dataset.src !== s.thumbnail) {
			art.dataset.src = s.thumbnail;
			art.src = s.thumbnail;
			if (settings.blur) artBg.style.backgroundImage = `url("${s.thumbnail}")`;
		} else if (!s.thumbnail) {
			art.removeAttribute("src");
			delete art.dataset.src;
			if (settings.blur) artBg.style.backgroundImage = "";
		}

		durationEl.textContent = fmt(s.duration || 0);
		updateMarquee(titleEl, titleInner);
	}

	function rawProgress() {
		const s = current;
		if (!s || !s.hasTrack) return 0;
		let p = anchorPos;
		if (s.playing) p += (performance.now() - anchorClock) / 1000;
		const dur = s.duration || 0;
		if (dur > 0) p = Math.min(p, dur);
		return Math.max(0, p);
	}

	function displayedProgress() {
		if (easeOffset === 0) return rawProgress();
		const t = (performance.now() - easeClock) / EASE_MS;
		if (t >= 1) {
			easeOffset = 0;
			return rawProgress();
		}
		return Math.max(0, rawProgress() + easeOffset * (1 - t));
	}

	function tick() {
		const s = current;
		if (s && s.hasTrack && !card.classList.contains("hidden")) {
			const elapsed = displayedProgress();
			const dur = s.duration || 0;
			elapsedEl.textContent = fmt(elapsed);
			fill.style.width = dur > 0 ? `${(elapsed / dur) * 100}%` : "0%";
		}
		raf = requestAnimationFrame(tick);
	}

	function applySnapshot(payload) {
		const wasShowing = current && current.hasTrack;
		const prevDisplayed = wasShowing ? displayedProgress() : null;
		const prevTrack = anchorTrack;

		current = payload;
		const track = payload && payload.hasTrack ? `${payload.title}|${payload.artist}` : "";
		const next = payload && payload.hasTrack ? payload.currentTime || 0 : 0;

		anchorPos = next;
		anchorClock = performance.now();
		anchorTrack = track;

		const drift = prevDisplayed === null || track !== prevTrack ? null : prevDisplayed - next;
		easeOffset = drift !== null && Math.abs(drift) <= EASE_MAX_S ? drift : 0;
		if (easeOffset !== 0) easeClock = performance.now();

		render();
	}

	function applySettings(raw) {
		const next = normalizeSettings({ ...settings, ...(raw || {}) });
		// A URL param is a deliberate override for this one browser source, so a
		// dashboard change must not silently undo it.
		for (const key of forced) next[key] = settings[key];
		settings = next;

		const style = host.style;
		style.setProperty("--accent", settings.accent);
		style.setProperty("--text", settings.textColor);
		const rgb = hexToRgb(settings.bgColor);
		if (rgb) style.setProperty("--bg-rgb", rgb);
		style.setProperty("--bg-alpha", String(settings.opacity / 100));
		style.setProperty("--scale", String(settings.scale / 100));
		style.setProperty("--radius", `${settings.radius}px`);
		style.setProperty("--cover", `${settings.coverSize}px`);
		style.setProperty("--blur-amount", `${settings.blurAmount}px`);
		style.setProperty("--blur-brightness", String(1 - settings.blurDark / 100));

		for (const m of MODES) card.classList.toggle(m, settings.mode === m);
		for (const a of ALIGNS) card.classList.toggle(`align-${a}`, settings.align === a);
		card.classList.toggle("no-progress", !settings.showProgress);
		card.classList.toggle("bg-blur", settings.blur);
		artBg.style.backgroundImage =
			settings.blur && current && current.thumbnail ? `url("${current.thumbnail}")` : "";

		render();
	}

	applySettings(settings);
	raf = requestAnimationFrame(tick);

	return {
		card,
		applySnapshot,
		applySettings,
		getSettings: () => ({ ...settings }),
		setHideWhenIdle(v) {
			hideWhenIdle = !!v;
			render();
		},
		destroy() {
			cancelAnimationFrame(raf);
			host.innerHTML = "";
			host.classList.remove("ytm-overlay");
		},
	};
}

/**
 * Reads style overrides off a browser-source URL. Returns the settings to seed
 * with and the keys that must stay pinned against later live updates.
 */
export function settingsFromParams(params) {
	const seed = {};
	const forced = new Set();
	const take = (param, key, parse) => {
		if (!params.has(param)) return;
		const v = parse(params.get(param));
		if (v === undefined) return;
		seed[key] = v;
		forced.add(key);
	};

	take("accent", "accent", (v) => v);
	take("text", "textColor", (v) => v);
	take("bg", "blur", (v) => (v === "blur" ? true : undefined));
	take("mode", "mode", (v) => (MODES.includes(v) ? v : undefined));
	take("align", "align", (v) => (ALIGNS.includes(v) ? v : undefined));
	take("compact", "mode", (v) => (v === "1" ? "compact" : undefined));
	take("scale", "scale", Number);
	take("hideWhenPaused", "hideWhenPaused", (v) => v === "1");

	return { seed: normalizeSettings(seed), forced };
}
