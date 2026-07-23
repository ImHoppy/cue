/**
 * Builds the style controls from SETTING_FIELDS.
 */
import { DEFAULT_SETTINGS, SETTING_FIELDS, fieldVisible, formatValue, normalizeSettings } from "./contract.js";

/**
 * @param {HTMLElement} container
 * @param {object}   [opts]
 * @param {object}   [opts.settings]  starting values
 * @param {Function} [opts.onChange]  (settings, changedKey) — fires live while dragging
 * @param {boolean}  [opts.showReset] render the reset button
 */
export function createStyleEditor(container, opts = {}) {
	let settings = normalizeSettings(opts.settings);
	const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};
	const rows = new Map();

	container.classList.add("style-editor");
	container.innerHTML = "";

	let group = null;
	for (const field of SETTING_FIELDS) {
		if (field.group) {
			group = document.createElement("section");
			group.className = "se-group";
			group.innerHTML = `<h3 class="se-group-title">${field.group}</h3>`;
			container.append(group);
		}
		const row = buildRow(field);
		rows.set(field.key, row);
		(group || container).append(row.el);
	}

	if (opts.showReset) {
		const reset = document.createElement("button");
		reset.type = "button";
		reset.className = "se-reset";
		reset.textContent = "Reset to defaults";
		reset.addEventListener("click", () => {
			settings = { ...DEFAULT_SETTINGS };
			sync();
			onChange({ ...settings }, null);
		});
		container.append(reset);
	}

	function buildRow(field) {
		const el = document.createElement("div");
		el.className = `se-row se-${field.type}`;
		if (field.showIf) el.classList.add("se-child");

		const id = `se-${field.key}`;
		const label = document.createElement("label");
		label.className = "se-label";
		label.htmlFor = id;
		label.textContent = field.label;

		let input;
		let readout = null;

		if (field.type === "select") {
			input = document.createElement("select");
			for (const o of field.options) {
				const opt = document.createElement("option");
				opt.value = o.value;
				opt.textContent = o.label;
				input.append(opt);
			}
		} else if (field.type === "toggle") {
			input = document.createElement("input");
			input.type = "checkbox";
		} else if (field.type === "color") {
			input = document.createElement("input");
			input.type = "color";
		} else {
			input = document.createElement("input");
			input.type = "range";
			input.min = String(field.min);
			input.max = String(field.max);
			input.step = String(field.step ?? 1);
			readout = document.createElement("span");
			readout.className = "se-value";
		}
		input.id = id;
		input.className = "se-input";

		const commit = () => {
			settings = normalizeSettings({ ...settings, [field.key]: readInput(field, input) });
			sync();
			onChange({ ...settings }, field.key);
		};
		// Ranges and colors report continuously; select and checkbox only settle.
		input.addEventListener(field.type === "range" || field.type === "color" ? "input" : "change", commit);

		const control = document.createElement("span");
		control.className = "se-control";
		control.append(input);
		if (readout) control.append(readout);

		el.append(label, control);
		return { el, input, readout, field };
	}

	function readInput(field, input) {
		if (field.type === "toggle") return input.checked;
		if (field.type === "range") return Number(input.value);
		return input.value;
	}

	function sync() {
		for (const { el, input, readout, field } of rows.values()) {
			const value = settings[field.key];
			if (field.type === "toggle") input.checked = !!value;
			else if (String(input.value) !== String(value)) input.value = String(value);
			if (readout) readout.textContent = formatValue(field, value);
			el.hidden = !fieldVisible(field, settings);
		}
	}

	sync();

	return {
		getSettings: () => ({ ...settings }),
		/** Applies values from elsewhere (server pull, another tab) without firing onChange. */
		setSettings(next) {
			settings = normalizeSettings(next);
			sync();
		},
	};
}
