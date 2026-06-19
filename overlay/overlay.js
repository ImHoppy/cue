(function () {
	const params = new URLSearchParams(location.search);

	const accent = params.get("accent");
	if (accent) document.documentElement.style.setProperty("--accent", accent);
	const hideWhenIdle = params.get("hideWhenIdle") !== "0";
	const hideWhenPaused = params.get("hideWhenPaused") === "1";

	const card = document.getElementById("card");
	const art = document.getElementById("art");
	const titleEl = document.getElementById("title");
	const artistEl = document.getElementById("artist");
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

		titleEl.textContent = s.title || "—";
		titleEl.title = s.title || "";
		artistEl.textContent = s.artist || "";
		artistEl.title = s.artist || "";

		if (s.thumbnail && art.dataset.src !== s.thumbnail) {
			art.dataset.src = s.thumbnail;
			art.src = s.thumbnail;
		} else if (!s.thumbnail) {
			art.removeAttribute("src");
		}

		const dur = s.duration || 0;
		durationEl.textContent = fmt(dur);
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

	let ws = null;
	function connect() {
		ws = new WebSocket(`ws://${location.host}/ws`);
		ws.onopen = () => ws.send(JSON.stringify({ role: "consumer" }));
		ws.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data);
				if (msg && msg.type === "NOW_PLAYING") applySnapshot(msg.payload);
			} catch {}
		};
		ws.onclose = () => setTimeout(connect, 1500);
		ws.onerror = () => { try { ws.close(); } catch {} };
	}

	connect();
	requestAnimationFrame(animate);
})();
