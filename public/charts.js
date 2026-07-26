/**
 * The chart pieces the admin page is built from — plain DOM, no library.
 *
 * Two rules shape everything here and are worth stating because they are easy
 * to undo by accident:
 *
 *   Colour follows the *job*, not the value. Nominal breakdowns (which layout
 *   people picked) all take one hue, because ramping them would encode bar
 *   length twice and say nothing new. The funnel takes a validated single-hue
 *   ordinal ramp, and the ramp tracks stage position, not count.
 *
 *   A tooltip never holds the only copy of a value. Every chart here either
 *   direct-labels its bars or ships a table view toggle.
 */

import { dateFormat, numberFormat, t } from "/shared/i18n.js";

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

export const formatCount = (n) =>
	n >= 10000
		? numberFormat({ notation: "compact", maximumFractionDigits: 1 }).format(n)
		: numberFormat().format(n);

export function formatDuration(ms) {
	const mins = Math.floor(ms / 60000);
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 48) return `${hours}h ${mins % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const dayLabel = (iso) =>
	dateFormat({ day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

// ---- one shared tooltip ----------------------------------------------------

let tip = null;

function showTip(target, html) {
	if (!tip) {
		tip = el("div", "viz-tip");
		document.body.append(tip);
	}
	tip.innerHTML = html;
	tip.classList.add("show");
	const box = target.getBoundingClientRect();
	const own = tip.getBoundingClientRect();
	// Kept inside the viewport so an edge column's tooltip is not cut off.
	const left = Math.min(Math.max(8, box.left + box.width / 2 - own.width / 2), innerWidth - own.width - 8);
	tip.style.left = `${left}px`;
	tip.style.top = `${Math.max(8, box.top - own.height - 8)}px`;
}

const hideTip = () => tip?.classList.remove("show");

/** Hover and keyboard focus show the same thing — focus is not a lesser path. */
function bindTip(node, html) {
	const show = () => showTip(node, html);
	node.addEventListener("mouseenter", show);
	node.addEventListener("focus", show);
	node.addEventListener("mouseleave", hideTip);
	node.addEventListener("blur", hideTip);
}

// ---- stat tiles ------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.label  sentence case, no trailing colon
 * @param {number} opts.value
 * @param {{current:number, previous:number, period:string}} [opts.delta]
 */
export function statTile({ label, value, delta }) {
	const tile = el("div", "tile");
	tile.append(el("span", "tile-label", label), el("strong", "tile-value", formatCount(value)));

	if (delta) {
		const diff = delta.current - delta.previous;
		const line = el("span", "tile-delta");
		if (delta.previous === 0 && diff === 0) {
			line.textContent = t("admin.delta.none", { period: delta.period });
		} else {
			const direction = el("span", diff > 0 ? "up" : diff < 0 ? "down" : "", `${diff > 0 ? "+" : ""}${diff}`);
			line.append(direction, document.createTextNode(t("admin.delta.vs", { period: delta.period })));
		}
		tile.append(line);
	}
	return tile;
}

// ---- column chart ----------------------------------------------------------

/**
 * Rounds an axis maximum up to a clean tick value.
 *
 * Every candidate is even, because the chart draws a gridline at half the
 * maximum and these are counts — an odd maximum would put a line labelled "2"
 * at 1.5, which is worse than no gridline at all.
 */
function niceMax(value) {
	const v = Math.max(2, value);
	const power = 10 ** Math.floor(Math.log10(v));
	for (const step of [1, 2, 4, 5, 8, 10]) {
		const candidate = step * power;
		if (v <= candidate && candidate % 2 === 0) return candidate;
	}
	return 10 * power;
}

/**
 * Daily counts. One series, so no legend — the title says what is plotted.
 * Only the peak is direct-labelled; the axis ticks and the table view carry
 * the rest.
 *
 * @param {HTMLElement} host
 * @param {Array<{day: string, count: number}>} data
 * @param {string} nounKey  i18n key for what one unit is, pluralized in the tooltip
 */
export function columnChart(host, data, nounKey) {
	host.innerHTML = "";
	const counts = data.map((d) => d.count);
	const top = niceMax(Math.max(...counts, 0));
	const peak = Math.max(...counts, 0);
	let peakLabelled = false;

	const plot = el("div", "columns");

	const grid = el("div", "col-grid");
	for (const fraction of [0, 0.5, 1]) {
		const line = el("span");
		line.style.top = `${(1 - fraction) * 100}%`;
		const tick = el("b", null, String(Math.round(top * fraction)));
		line.append(tick);
		grid.append(line);
	}
	plot.append(grid);

	for (const point of data) {
		const slot = el("div", "col-slot");
		const bar = el("div", "col-bar");
		const height = (point.count / top) * 100;
		bar.style.height = `${height}%`;
		slot.append(bar);

		// The extreme, not every point — a number on every column goes unread.
		if (point.count === peak && peak > 0 && !peakLabelled) {
			const label = el("span", "col-peak", String(point.count));
			label.style.bottom = `calc(${height}% + 5px)`;
			slot.append(label);
			peakLabelled = true;
		}

		// Only days with a value are worth a tab stop.
		if (point.count > 0) slot.tabIndex = 0;
		bindTip(slot, `<b>${point.count}</b> ${t(nounKey, { count: point.count })}<br>${dayLabel(point.day)}`);
		plot.append(slot);
	}

	const axis = el("div", "col-axis");
	const middle = data[Math.floor(data.length / 2)];
	axis.append(
		el("span", null, dayLabel(data[0].day)),
		el("span", null, middle ? dayLabel(middle.day) : ""),
		el("span", null, dayLabel(data[data.length - 1].day))
	);

	host.append(plot, axis);
}

/** The WCAG-clean twin of the column chart — every value, plainly. */
export function columnTable(host, data, nounKey) {
	host.innerHTML = "";
	const wrap = el("div", "tablewrap");
	const table = el("table");
	const head = el("tr");
	head.append(el("th", null, t("admin.table.day")), el("th", null, t(`${nounKey}.title`)));
	table.append(head);
	for (const point of data) {
		const row = el("tr");
		row.append(el("td", null, dayLabel(point.day)), el("td", "mono", String(point.count)));
		table.append(row);
	}
	wrap.append(table);
	host.append(wrap);
}

// ---- horizontal bars -------------------------------------------------------

/**
 * Magnitude across a handful of named rows, direct-labelled at the tip.
 *
 * @param {HTMLElement} host
 * @param {Array<{label: string, count: number}>} rows
 * @param {object} [opts]
 * @param {number}   [opts.total]   denominator for the percentage; defaults to the largest row
 * @param {string[]} [opts.ramp]    ordinal ramp, one entry per row — ONLY for ordered rows
 * @param {boolean}  [opts.percent] show the share beside the count
 */
export function barChart(host, rows, opts = {}) {
	host.innerHTML = "";
	const scale = Math.max(opts.total ?? 0, ...rows.map((r) => r.count), 1);
	const list = el("div", "hbars");

	rows.forEach((row, i) => {
		const line = el("div", "hbar");
		const track = el("div", "hbar-track");
		const fill = el("div", "hbar-fill");
		fill.style.width = `${(row.count / scale) * 100}%`;
		// A ramp entry is stage order. Without one, every bar is the same hue.
		if (opts.ramp) fill.style.background = opts.ramp[i] ?? opts.ramp[opts.ramp.length - 1];
		track.append(fill);

		const value = el("span", "hbar-value", formatCount(row.count));
		if (opts.percent && scale > 0) {
			value.append(el("small", null, `${Math.round((row.count / scale) * 100)}%`));
		}

		line.append(el("span", "hbar-label", row.label), track, value);
		list.append(line);
	});

	host.append(list);
}
