(function () {
	const params = new URLSearchParams(location.search);

	const accent = params.get("accent");
	if (accent) document.documentElement.style.setProperty("--accent", accent);
	let hideWhenIdle = params.get("hideWhenIdle") !== "0";
	let hideWhenPaused = params.get("hideWhenPaused") === "1";
	let blurBg = params.get("bg") === "blur";
	let compact = params.get("compact") === "1";

	const forced = new Set();
	const paramToKey = { accent: "accent", bg: "blur", compact: "compact", hideWhenIdle: "hideWhenIdle", hideWhenPaused: "hideWhenPaused" };
	for (const p in paramToKey) if (params.has(p)) forced.add(paramToKey[p]);

	const card = document.getElementById("card");
	if (blurBg) card.classList.add("bg-blur");
	if (compact) card.classList.add("compact");
	const artBg = document.getElementById("artBg");
	const art = document.getElementById("art");
	const titleEl = document.getElementById("title");
	const artistEl = document.getElementById("artist");
	const titleInner = titleEl.querySelector(".scroll-inner");
	const artistInner = artistEl.querySelector(".scroll-inner");
	const elapsedEl = document.getElementById("elapsed");
	const durationEl = document.getElementById("duration");
	const fill = document.getElementById("fill");

	let current = null;
	let localProgress = 0;
	let lastUpdateClock = 0;

	function fmt(sec) {
		sec = Math.max(0, Math.floor(sec || 0));
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		return `${m}:${String(s).padStart(2, "0")}`;
	}

	function updateMarquee(box, inner) {
		const sig = inner.textContent + "|" + box.clientWidth;
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
		if (hideWhenPaused && !s.playing) {
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
			if (blurBg) artBg.style.backgroundImage = `url("${s.thumbnail}")`;
		} else if (!s.thumbnail) {
			art.removeAttribute("src");
			if (blurBg) artBg.style.backgroundImage = "";
		}

		const dur = s.duration || 0;
		durationEl.textContent = fmt(dur);

		updateMarquee(titleEl, titleInner);
	}

	function animate() {
		const s = current;
		if (s && s.hasTrack && !card.classList.contains("hidden")) {
			let elapsed = localProgress;
			if (s.playing) {
				elapsed += (performance.now() - lastUpdateClock) / 1000;
			}
			const dur = s.duration || 0;
			if (dur > 0) elapsed = Math.min(elapsed, dur);
			elapsedEl.textContent = fmt(elapsed);
			fill.style.width = dur > 0 ? `${(elapsed / dur) * 100}%` : "0%";
		}
		requestAnimationFrame(animate);
	}

	function applySnapshot(payload) {
		current = payload;
		localProgress = payload && payload.currentTime ? payload.currentTime : 0;
		lastUpdateClock = performance.now();
		render();
	}

	function hexToRgb(hex) {
		const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
		if (!m) return null;
		const n = parseInt(m[1], 16);
		return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
	}

	function applySettings(s) {
		if (!s || typeof s !== "object") return;
		const root = document.documentElement.style;
		const num = (v) => typeof v === "number" && !Number.isNaN(v);
		if (typeof s.accent === "string" && s.accent && !forced.has("accent")) {
			root.setProperty("--accent", s.accent);
		}
		if (typeof s.textColor === "string" && s.textColor) {
			root.setProperty("--text", s.textColor);
		}
		if (typeof s.bgColor === "string") {
			const rgb = hexToRgb(s.bgColor);
			if (rgb) root.setProperty("--bg-rgb", rgb);
		}
		if (num(s.opacity)) {
			root.setProperty("--bg-alpha", String(Math.max(0, Math.min(1, s.opacity / 100))));
		}
		if (num(s.scale)) {
			root.setProperty("--scale", String(Math.max(0.2, s.scale / 100)));
		}
		if (num(s.radius)) {
			root.setProperty("--radius", `${Math.max(0, s.radius)}px`);
		}
		if (num(s.blurAmount)) {
			root.setProperty("--blur-amount", `${Math.max(0, s.blurAmount)}px`);
		}
		if (num(s.blurDark)) {
			root.setProperty("--blur-brightness", String(Math.max(0, Math.min(1, 1 - s.blurDark / 100))));
		}
		if (typeof s.showProgress === "boolean") {
			card.classList.toggle("no-progress", !s.showProgress);
		}
		if (typeof s.compact === "boolean" && !forced.has("compact")) {
			compact = s.compact;
			card.classList.toggle("compact", compact);
		}
		if (typeof s.blur === "boolean" && !forced.has("blur")) {
			blurBg = s.blur;
			card.classList.toggle("bg-blur", blurBg);
			if (blurBg && current && current.thumbnail) {
				artBg.style.backgroundImage = `url("${current.thumbnail}")`;
			} else if (!blurBg) {
				artBg.style.backgroundImage = "";
			}
		}
		if (typeof s.hideWhenIdle === "boolean" && !forced.has("hideWhenIdle")) hideWhenIdle = s.hideWhenIdle;
		if (typeof s.hideWhenPaused === "boolean" && !forced.has("hideWhenPaused")) hideWhenPaused = s.hideWhenPaused;
		render();
	}

	let ws = null;
	function connect() {
		ws = new WebSocket(`ws://${location.host}/ws`);
		ws.onopen = () => ws.send(JSON.stringify({ role: "consumer" }));
		ws.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data);
				if (msg && msg.type === "NOW_PLAYING") applySnapshot(msg.payload);
				else if (msg && msg.type === "SETTINGS") applySettings(msg.payload);
			} catch {}
		};
		ws.onclose = () => setTimeout(connect, 1500);
		ws.onerror = () => { try { ws.close(); } catch {} };
	}

	connect();
	requestAnimationFrame(animate);
})();
