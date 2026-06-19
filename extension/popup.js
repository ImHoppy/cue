const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const portInput = document.getElementById("port");
const overlayUrl = document.getElementById("overlayUrl");
const dot = document.getElementById("dot");
const status = document.getElementById("status");

async function load() {
	const { serverPort } = await browserAPI.storage.local.get("serverPort");
	const port = Number(serverPort) || 8787;
	portInput.value = port;
	overlayUrl.textContent = `http://localhost:${port}/`;

	browserAPI.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
		if (!res) return;
		const ok = res.connected;
		dot.className = "dot " + (ok ? "on" : "off");
		status.textContent = ok ? "Connected to overlay server" : "Disconnected";
		const snap = res.lastSnapshot;
		if (snap && snap.hasTrack) {
			document.getElementById("track").style.display = "block";
			document.getElementById("trackTitle").textContent = snap.title || "";
			document.getElementById("trackArtist").textContent = snap.artist || "";
		}
	});
}

document.getElementById("save").addEventListener("click", async () => {
	const port = Math.min(65535, Math.max(1, Number(portInput.value) || 8787));
	await browserAPI.storage.local.set({ serverPort: port });
	overlayUrl.textContent = `http://localhost:${port}/`;
	status.textContent = "Saved. Reconnecting…";
});

load();
