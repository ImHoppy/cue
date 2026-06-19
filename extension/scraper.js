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

function getThumbnailUrl() {
	const queueItem = getQueueItem();
	if (queueItem) {
		const queueImg = queueItem.querySelector('img#img');
		const queueSrc = queueImg?.src || queueImg?.getAttribute?.('src') || "";
		if (queueSrc && !queueSrc.includes('data:image')) return queueSrc;
	}

	const playerBar = document.querySelector('ytmusic-player-bar');
	if (playerBar) {
		const playerImg = playerBar.querySelector('.middle-controls img, .thumbnail img, img.yt-img-shadow');
		const playerSrc = playerImg?.src || playerImg?.getAttribute?.('src') || "";
		if (playerSrc && !playerSrc.includes('data:image')) return playerSrc;
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

let lastSignature = "";

function signatureOf(snap) {
	if (!snap.hasTrack) return "none";
	return [snap.title, snap.artist, snap.thumbnail, snap.playing, snap.duration, Math.floor(snap.currentTime / 2)].join("|");
}

function tick() {
	const snap = buildSnapshot();
	const sig = signatureOf(snap);
	if (sig === lastSignature) return;
	lastSignature = sig;
	try {
		browserAPI.runtime.sendMessage({ type: "NOW_PLAYING", payload: snap }).catch(() => {});
	} catch {}
}

setInterval(tick, 1000);
document.addEventListener('yt-navigate-finish', () => { lastSignature = ""; tick(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
tick();
