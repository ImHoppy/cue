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
import { LANGS, LANG_NAMES, applyTranslations, getLang, initLang, setLang, t } from "/shared/i18n.js";

export { PROVIDERS, BROWSERS, providerById } from "/shared/contract.js";
export { t, getLang, applyTranslations } from "/shared/i18n.js";

initLang();
applyTranslations();

// ---- plumbing --------------------------------------------------------------

export function errorMessage(code) {
	if (!code) return t("errors.unknown", { code: "?" });
	const key = `errors.${code}`;
	const text = t(key);
	return text === key ? t("errors.unknown", { code }) : text;
}

export async function api(path, { method = "GET", body } = {}) {
	let res;
	try {
		res = await fetch(path, {
			method,
			headers: body ? { "content-type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch {
		throw new Error(t("errors.network"));
	}
	if (res.status === 401) {
		location.href = "/";
		throw new Error(t("errors.not_signed_in"));
	}
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	if (!res.ok) {
		const err = new Error(errorMessage(data?.error ?? String(res.status)));
		err.code = data?.error ?? null;
		throw err;
	}
	return data;
}

/** The EN | FR switch. Changing language reloads so the server restamps the page. */
export function mountLangSwitch(container) {
	const wrap = el("span", "langswitch");
	wrap.setAttribute("role", "group");
	wrap.setAttribute("aria-label", t("common.language"));
	for (const code of LANGS) {
		const button = el("button", "lang", code.toUpperCase());
		button.type = "button";
		button.title = LANG_NAMES[code];
		button.setAttribute("aria-pressed", String(code === getLang()));
		button.addEventListener("click", () => setLang(code));
		wrap.append(button);
	}
	container.append(wrap);
	return wrap;
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
	button.textContent = copyable ? t("common.copy") : "—";
	button.disabled = !copyable;
	button.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(value);
			button.textContent = t("common.copied");
			toast(t("common.copiedToast", { label: label || t("common.value") }));
			setTimeout(() => (button.textContent = t("common.copy")), 1600);
		} catch {
			toast(t("common.clipboardBlocked"), true);
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

export const SCENES = [
	{ id: "dark", labelKey: "studio.scene.dark" },
	{ id: "bright", labelKey: "studio.scene.bright" },
	{ id: "grid", labelKey: "studio.scene.grid" },
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
		const chip = el("button", "chip", t(s.labelKey));
		chip.type = "button";
		chip.setAttribute("aria-pressed", String(s.id === "dark"));
		chip.addEventListener("click", () => {
			scene.dataset.scene = s.id;
			sceneButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(SCENES[i].id === s.id)));
		});
		return chip;
	});

	const playChip = el("button", "chip", t("studio.pause"));
	playChip.type = "button";
	const skipChip = el("button", "chip", t("studio.next"));
	skipChip.type = "button";
	const status = el("span", "chip spacer", t("studio.testTrack"));

	bar.append(...sceneButtons, playChip, skipChip, status);
	left.append(scene, bar);

	const editorWrap = el("div");
	root.append(left, editorWrap);

	const overlay = createOverlay(mount, { initial: opts.settings });
	const player = createFakePlayer({ onSnapshot: (snap) => overlay.applySnapshot(snap) });
	player.start();

	playChip.addEventListener("click", () => {
		playChip.textContent = player.toggle() ? t("studio.pause") : t("studio.play");
	});
	skipChip.addEventListener("click", () => player.next());

	let saveTimer = 0;

	function save(settings) {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				const res = await api("/api/me/settings", { method: "PUT", body: { settings } });
				status.textContent = t("studio.saved");
				opts.onSaved?.(res.settings);
			} catch (err) {
				toast(t("studio.saveFailed", { message: err.message }), true);
				status.textContent = t("studio.notSaved");
			}
		}, 400);
	}

	const editor = createStyleEditor(editorWrap, {
		settings: opts.settings,
		showReset: true,
		onChange(settings) {
			overlay.applySettings(settings);
			status.textContent = t("studio.saving");
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
