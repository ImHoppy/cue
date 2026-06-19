const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_PORT = 8787;
let ws = null;
let connected = false;
let reconnectTimer = null;
let lastSnapshot = { hasTrack: false, playing: false };

async function getPort() {
	try {
		const { serverPort } = await browserAPI.storage.local.get("serverPort");
		return Number(serverPort) || DEFAULT_PORT;
	} catch {
		return DEFAULT_PORT;
	}
}

async function connect() {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

	const port = await getPort();
	try {
		ws = new WebSocket(`ws://localhost:${port}/ws`);
	} catch {
		scheduleReconnect();
		return;
	}

	ws.onopen = () => {
		connected = true;
		ws.send(JSON.stringify({ role: "producer" }));
		send(lastSnapshot);
	};

	ws.onclose = () => { connected = false; scheduleReconnect(); };
	ws.onerror = () => { try { ws.close(); } catch {} };
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, 2000);
}

function send(snapshot) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	try {
		ws.send(JSON.stringify({ type: "NOW_PLAYING", payload: snapshot }));
	} catch {}
}

browserAPI.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg && msg.type === "NOW_PLAYING") {
		lastSnapshot = msg.payload;
		connect();
		send(lastSnapshot);
	}
	if (msg && msg.type === "GET_STATUS") {
		sendResponse({ connected, port: undefined, lastSnapshot });
		return true;
	}
});

browserAPI.alarms.create("keepalive", { periodInMinutes: 0.25 });
browserAPI.alarms.onAlarm.addListener(() => connect());

connect();
