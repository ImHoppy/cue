const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
	accent: "#ff2d55",
	textColor: "#ffffff",
	bgColor: "#121216",
	opacity: 82,
	scale: 100,
	radius: 12,
	blur: false,
	blurAmount: 26,
	blurDark: 50,
	compact: false,
	showProgress: true,
	hideWhenPaused: false,
};

const portInput = document.getElementById("port");
const overlayUrl = document.getElementById("overlayUrl");
const dot = document.getElementById("dot");
const status = document.getElementById("status");

const accentInput = document.getElementById("accent");
const textColorInput = document.getElementById("textColor");
const bgColorInput = document.getElementById("bgColor");
const opacityInput = document.getElementById("opacity");
const opacityVal = document.getElementById("opacityVal");
const scaleInput = document.getElementById("scale");
const scaleVal = document.getElementById("scaleVal");
const radiusInput = document.getElementById("radius");
const radiusVal = document.getElementById("radiusVal");
const compactInput = document.getElementById("compact");
const showProgressInput = document.getElementById("showProgress");
const blurInput = document.getElementById("blur");
const blurAmountInput = document.getElementById("blurAmount");
const blurAmountVal = document.getElementById("blurAmountVal");
const blurDarkInput = document.getElementById("blurDark");
const blurDarkVal = document.getElementById("blurDarkVal");
const blurOpts = document.getElementById("blurOpts");
const hidePausedInput = document.getElementById("hideWhenPaused");

function readSettings() {
	return {
		accent: accentInput.value || DEFAULT_SETTINGS.accent,
		textColor: textColorInput.value || DEFAULT_SETTINGS.textColor,
		bgColor: bgColorInput.value || DEFAULT_SETTINGS.bgColor,
		opacity: Number(opacityInput.value),
		scale: Number(scaleInput.value),
		radius: Number(radiusInput.value),
		compact: compactInput.checked,
		showProgress: showProgressInput.checked,
		blur: blurInput.checked,
		blurAmount: Number(blurAmountInput.value),
		blurDark: Number(blurDarkInput.value),
		hideWhenPaused: hidePausedInput.checked,
	};
}

function applySettingsToUI(s) {
	accentInput.value = s.accent || DEFAULT_SETTINGS.accent;
	textColorInput.value = s.textColor || DEFAULT_SETTINGS.textColor;
	bgColorInput.value = s.bgColor || DEFAULT_SETTINGS.bgColor;
	opacityInput.value = s.opacity;
	opacityVal.textContent = `${s.opacity}%`;
	scaleInput.value = s.scale;
	scaleVal.textContent = `${s.scale}%`;
	radiusInput.value = s.radius;
	radiusVal.textContent = `${s.radius}px`;
	compactInput.checked = !!s.compact;
	showProgressInput.checked = !!s.showProgress;
	blurInput.checked = !!s.blur;
	blurAmountInput.value = s.blurAmount;
	blurAmountVal.textContent = `${s.blurAmount}px`;
	blurDarkInput.value = s.blurDark;
	blurDarkVal.textContent = `${s.blurDark}%`;
	blurOpts.style.display = s.blur ? "block" : "none";
}

function pushSettings() {
	const s = readSettings();
	opacityVal.textContent = `${s.opacity}%`;
	scaleVal.textContent = `${s.scale}%`;
	radiusVal.textContent = `${s.radius}px`;
	blurAmountVal.textContent = `${s.blurAmount}px`;
	blurDarkVal.textContent = `${s.blurDark}%`;
	blurOpts.style.display = s.blur ? "block" : "none";
	browserAPI.runtime.sendMessage({ type: "SET_SETTINGS", payload: s });
}

async function load() {
	const { serverPort, overlaySettings } = await browserAPI.storage.local.get([
		"serverPort",
		"overlaySettings",
	]);
	const port = Number(serverPort) || 8787;
	portInput.value = port;
	overlayUrl.textContent = `http://localhost:${port}/`;
	applySettingsToUI({ ...DEFAULT_SETTINGS, ...(overlaySettings || {}) });

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

[opacityInput, scaleInput, radiusInput, blurAmountInput, blurDarkInput].forEach(
	(el) => el.addEventListener("input", pushSettings)
);
[accentInput, textColorInput, bgColorInput].forEach((el) =>
	el.addEventListener("input", pushSettings)
);
[compactInput, showProgressInput, blurInput, hidePausedInput].forEach((el) =>
	el.addEventListener("change", pushSettings)
);

document.getElementById("reset").addEventListener("click", () => {
	applySettingsToUI(DEFAULT_SETTINGS);
	pushSettings();
});

load();
