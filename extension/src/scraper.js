/**
 * Scrapes the YouTube Music tab and hands anchors to the background worker.
 *
 * Wrapped in an IIFE with a re-entry guard because this file arrives two ways:
 * the manifest injects it into pages loaded after the extension starts, and
 * background.js injects it into tabs that were already open at install time.
 * Both can land on the same tab. Without the guard the second copy would
 * redeclare every top-level binding in the shared isolated world and throw.
 */
(function () {
	if (window.__cueScraperRunning) return;
	window.__cueScraperRunning = true;

	const browserAPI = typeof browser !== "undefined" ? browser : chrome;

	function getQueueItem() {
		return document.querySelector('ytmusic-player-queue-item[play-button-state="playing"]')
			|| document.querySelector('ytmusic-player-queue-item[play-button-state="paused"]')
			|| document.querySelector('ytmusic-player-queue-item[selected]')
			|| null;
	}

	function parseTimeString(timeString) {
		if (!timeString) return 0;
		const parts = timeString.trim().split(':').map(Number);
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		if (parts.length === 2) return parts[0] * 60 + parts[1];
		return parts[0] || 0;
	}

	function isMusicCurrentlyPlaying() {
		const queueItem = getQueueItem();
		if (queueItem) {
			const state = queueItem.getAttribute('play-button-state');
			if (state) return state.toLowerCase() !== 'paused';
		}

		const playerBar = document.querySelector('ytmusic-player-bar');
		const playButton = playerBar?.querySelector('tp-yt-paper-icon-button.play-pause-button');
		const title = (playButton?.getAttribute('title') || '').toLowerCase();
		if (title.includes('pause')) return true;
		if (title.includes('play')) return false;

		const video = document.querySelector('video');
		if (video) return !video.paused;

		return false;
	}

	function getCleanTitle() {
		const queueItem = getQueueItem();
		if (queueItem) {
			const titleElement = queueItem.querySelector('.song-title');
			const title = titleElement?.textContent?.trim();
			if (title) return title;
		}

		const playerBarTitle = document.querySelector('ytmusic-player-bar .title, ytmusic-player-bar .content-info-wrapper .title')
			?.textContent?.trim();
		return playerBarTitle || null;
	}

	function getArtist() {
		const queueItem = getQueueItem();
		if (!queueItem) {
			const playerBar = document.querySelector('ytmusic-player-bar');
			const playerByline = playerBar?.querySelector('.byline a, .content-info-wrapper .byline a')?.textContent?.trim()
				|| playerBar?.querySelector('.byline, .content-info-wrapper .byline')?.textContent?.trim()
				|| "YouTube Music";
			return String(playerByline).split(/[•·]/)[0].trim() || "YouTube Music";
		}

		const bylineElement = queueItem.querySelector('.byline');
		const raw = bylineElement?.querySelector('a')?.textContent?.trim()
			|| bylineElement?.textContent?.trim()
			|| "YouTube Music";
		return String(raw).split(/[•·]/)[0].trim() || "YouTube Music";
	}

	function upscaleThumbnail(url) {
		return url.replace(/=w\d+-h\d+/, '=w544-h544');
	}

	function getThumbnailUrl() {
		const queueItem = getQueueItem();
		if (queueItem) {
			const queueImg = queueItem.querySelector('img#img');
			const queueSrc = queueImg?.src || queueImg?.getAttribute?.('src') || "";
			if (queueSrc && !queueSrc.includes('data:image')) return upscaleThumbnail(queueSrc);
		}

		const playerBar = document.querySelector('ytmusic-player-bar');
		if (playerBar) {
			const playerImg = playerBar.querySelector('.middle-controls img, .thumbnail img, img.yt-img-shadow');
			const playerSrc = playerImg?.src || playerImg?.getAttribute?.('src') || "";
			if (playerSrc && !playerSrc.includes('data:image')) return upscaleThumbnail(playerSrc);
		}

		return "";
	}

	function getDuration() {
		const video = document.querySelector('video');
		if (video && video.readyState >= 1 && isFinite(video.duration)) return video.duration;

		const queueItem = getQueueItem();
		if (!queueItem) return 0;
		return parseTimeString(queueItem.querySelector('.duration')?.textContent);
	}

	function getCurrentTime() {
		const video = document.querySelector('video');
		if (video && video.readyState >= 1) return video.currentTime;

		const timeInfo = document.querySelector('ytmusic-player-bar .time-info');
		if (!timeInfo) return 0;
		const match = (timeInfo.textContent || "").match(/^[\s]*([^\s/]+)/);
		return match ? parseTimeString(match[1]) : 0;
	}

	function buildSnapshot() {
		const title = getCleanTitle();
		if (!title) {
			return { playing: false, hasTrack: false };
		}
		return {
			hasTrack: true,
			playing: isMusicCurrentlyPlaying(),
			title,
			artist: getArtist(),
			thumbnail: getThumbnailUrl(),
			duration: Math.round(getDuration()),
			currentTime: Math.round(getCurrentTime()),
			updatedAt: Date.now()
		};
	}

	// Anchors, not a position stream: the overlay extrapolates between sends, so we
	// only speak up when it would otherwise be wrong.
	const driftS = 1.5;
	const resyncMs = 10000; // doubles as the liveness signal for the server's hub TTL

	let lastMeta = "";
	let lastSentPos = 0;
	let lastSentClock = 0;
	let lastSentPlaying = false;
	let lastSentAt = -Infinity;

	function metaOf(snap) {
		if (!snap.hasTrack) return "none";
		return [snap.title, snap.artist, snap.thumbnail, snap.playing, snap.duration].join("|");
	}

	function emit(snap, meta, now) {
		lastMeta = meta;
		lastSentPos = snap.hasTrack ? snap.currentTime : 0;
		lastSentPlaying = !!snap.playing;
		lastSentClock = now;
		lastSentAt = now;
		try {
			browserAPI.runtime.sendMessage({ type: "NOW_PLAYING", payload: snap }).catch(() => {});
		} catch {}
	}

	function tick() {
		const snap = buildSnapshot();
		const meta = metaOf(snap);
		const now = performance.now();

		if (meta === lastMeta) {
			if (!snap.hasTrack) return;
			if (now - lastSentAt < resyncMs) {
				// Catches seeks and silent buffering stalls between resyncs.
				const predicted = lastSentPos + (lastSentPlaying ? (now - lastSentClock) / 1000 : 0);
				if (Math.abs(snap.currentTime - predicted) <= driftS) return;
			}
		}
		emit(snap, meta, now);
	}

	function resync() {
		lastMeta = "";
		tick();
	}

	setInterval(tick, 1000);
	document.addEventListener('yt-navigate-finish', resync);
	document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
	tick();
})();
