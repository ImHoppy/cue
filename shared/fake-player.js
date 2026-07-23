const cover = (from, to, glyph) =>
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="544" height="544" viewBox="0 0 544 544">
			<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
			</linearGradient></defs>
			<rect width="544" height="544" fill="url(#g)"/>
			<text x="272" y="272" font-family="Segoe UI, system-ui, sans-serif" font-size="220"
				font-weight="700" fill="rgba(255,255,255,0.9)" text-anchor="middle"
				dominant-baseline="central">${glyph}</text>
		</svg>`.replace(/\s+/g, " ")
	);

export const FAKE_TRACKS = [
	{ title: "Night Ferry", artist: "Kaeda", duration: 212, thumbnail: cover("#ff2d55", "#7a1030", "◆") },
	{
		title: "A Perfectly Reasonable Title That Goes On Rather Longer Than It Should",
		artist: "The Marquee Test",
		duration: 184,
		thumbnail: cover("#3b82f6", "#0b2a5e", "▲"),
	},
	{ title: "Static Bloom", artist: "Oyster Club", duration: 247, thumbnail: cover("#ffae3b", "#7a4a06", "●") },
	{ title: "Undertow", artist: "", duration: 168, thumbnail: cover("#4fd8e8", "#0a4650", "■") },
];

const RESYNC_MS = 5000;
const CLOCK_MS = 250;

/**
 * @param {object}   opts
 * @param {Function} opts.onSnapshot  receives the same shape the server broadcasts
 * @param {boolean}  [opts.autoplay]  default true
 */
export function createFakePlayer(opts) {
	const emit = opts.onSnapshot;
	let index = 0;
	let position = 0;
	let playing = opts.autoplay !== false;
	let lastEmit = -Infinity;
	let lastClock = performance.now();
	let timer = 0;

	const track = () => FAKE_TRACKS[index % FAKE_TRACKS.length];

	function snapshot() {
		const t = track();
		return {
			hasTrack: true,
			playing,
			title: t.title,
			artist: t.artist,
			thumbnail: t.thumbnail,
			duration: t.duration,
			currentTime: Math.round(position),
			updatedAt: Date.now(),
		};
	}

	function send() {
		lastEmit = performance.now();
		emit(snapshot());
	}

	function tick() {
		const now = performance.now();
		const dt = (now - lastClock) / 1000;
		lastClock = now;
		if (playing) position += dt;

		if (position >= track().duration) {
			index = (index + 1) % FAKE_TRACKS.length;
			position = 0;
			send();
			return;
		}
		if (now - lastEmit >= RESYNC_MS) send();
	}

	function start() {
		if (timer) return;
		lastClock = performance.now();
		timer = setInterval(tick, CLOCK_MS);
		send();
	}

	return {
		start,
		stop() {
			clearInterval(timer);
			timer = 0;
		},
		get playing() {
			return playing;
		},
		/** Pause and play are the point of hideWhenPaused, so make them testable. */
		toggle() {
			playing = !playing;
			lastClock = performance.now();
			send();
			return playing;
		},
		next() {
			index = (index + 1) % FAKE_TRACKS.length;
			position = 0;
			send();
		},
		seek(seconds) {
			position = Math.max(0, Math.min(track().duration, seconds));
			send();
		},
		snapshot,
	};
}
