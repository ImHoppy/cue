/**
 * Shared front-end for the website.
 *
 * The style studio here is the same code the setup wizard's last step and the
 * dashboard both mount, and the card it previews is the same renderer and the
 * same stylesheet the OBS browser source loads. What you see while dragging a
 * slider is the overlay, not a drawing of it.
 */
import { createOverlay } from "/shared/overlay-core.js";
import { createFakePlayer } from "/shared/fake-player.js";
import { createStyleEditor } from "/shared/style-editor.js";

export { PROVIDERS, BROWSERS, providerById } from "/shared/contract.js";

// ---- plumbing --------------------------------------------------------------

export async function api(path, { method = "GET", body } = {}) {
	const res = await fetch(path, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (res.status === 401) {
		location.href = "/";
		throw new Error("signed out");
	}
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
	return data;
}

let toastEl = null;
let toastTimer = 0;

export function toast(message, bad = false) {
	if (!toastEl) {
		toastEl = document.createElement("div");
		toastEl.className = "toast";
		toastEl.setAttribute("role", "status");
		document.body.append(toastEl);
	}
	toastEl.textContent = message;
	toastEl.classList.toggle("bad", bad);
	toastEl.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

/** Renders a value with a copy button. `masked` shows one string but copies another. */
export function copyField(value, { label, masked } = {}) {
	const wrap = document.createElement("div");
	if (label) {
		const l = document.createElement("span");
		l.className = "label";
		l.textContent = label;
		wrap.append(l);
	}
	const field = document.createElement("div");
	field.className = "copyfield";
	const code = document.createElement("code");
	code.textContent = masked ?? value;
	if (masked) code.classList.add("masked");
	const button = document.createElement("button");
	button.type = "button";

	const copyable = value !== null && value !== undefined;
	button.textContent = copyable ? "Copy" : "—";
	button.disabled = !copyable;
	button.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(value);
			button.textContent = "Copied";
			toast(`${label || "Value"} copied`);
			setTimeout(() => (button.textContent = "Copy"), 1600);
		} catch {
			toast("Your browser blocked the clipboard — select the text and copy it", true);
		}
	});

	field.append(code, button);
	wrap.append(field);
	return wrap;
}

export function setLamp(lit) {
	document.querySelectorAll(".lamp").forEach((el) => el.classList.toggle("lit", lit));
}

export const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

// ---- the style studio ------------------------------------------------------

const SCENES = [
	{ id: "dark", label: "Dark scene" },
	{ id: "bright", label: "Bright scene" },
	{ id: "grid", label: "Transparent" },
];

/**
 * Live preview beside the controls, driven by a fake track.
 *
 * @param {HTMLElement} root
 * @param {object}   opts
 * @param {object}   opts.settings  starting values, from the account
 * @param {Function} [opts.onSaved] called after a save lands
 * @param {boolean}  [opts.autosave] default true — saves the moment you stop dragging
 */
export function mountStyleStudio(root, opts) {
	root.innerHTML = "";
	root.classList.add("studio");

	const left = el("div");
	const scene = el("div", "scene");
	scene.dataset.scene = "dark";
	const mount = el("div", "mount");
	scene.append(mount);

	const bar = el("div", "scene-bar");
	const sceneButtons = SCENES.map((s) => {
		const chip = el("button", "chip", s.label);
		chip.type = "button";
		chip.setAttribute("aria-pressed", String(s.id === "dark"));
		chip.addEventListener("click", () => {
			scene.dataset.scene = s.id;
			sceneButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(SCENES[i].id === s.id)));
		});
		return chip;
	});

	const playChip = el("button", "chip", "Pause");
	playChip.type = "button";
	const skipChip = el("button", "chip", "Next track");
	skipChip.type = "button";
	const status = el("span", "chip spacer", "test track");

	bar.append(...sceneButtons, playChip, skipChip, status);
	left.append(scene, bar);

	const editorWrap = el("div");
	root.append(left, editorWrap);

	const overlay = createOverlay(mount, { initial: opts.settings });
	const player = createFakePlayer({ onSnapshot: (snap) => overlay.applySnapshot(snap) });
	player.start();

	playChip.addEventListener("click", () => {
		playChip.textContent = player.toggle() ? "Pause" : "Play";
	});
	skipChip.addEventListener("click", () => player.next());

	let saveTimer = 0;

	function save(settings) {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				const res = await api("/api/me/settings", { method: "PUT", body: { settings } });
				status.textContent = "saved";
				opts.onSaved?.(res.settings);
			} catch (err) {
				toast(`Could not save your style: ${err.message}`, true);
				status.textContent = "not saved";
			}
		}, 400);
	}

	const editor = createStyleEditor(editorWrap, {
		settings: opts.settings,
		showReset: true,
		onChange(settings) {
			overlay.applySettings(settings);
			status.textContent = "saving…";
			if (opts.autosave !== false) save(settings);
		},
	});

	return {
		getSettings: () => editor.getSettings(),
		/** Waits for a pending debounce so a "next step" click cannot outrun the save. */
		async flush() {
			clearTimeout(saveTimer);
			const settings = editor.getSettings();
			await api("/api/me/settings", { method: "PUT", body: { settings } });
			return settings;
		},
	};
}
