#!/usr/bin/env node
/**
 * Builds the browser extension, once per engine.
 *
 *   node extension/build.mjs                          both engines, unpacked
 *   node extension/build.mjs --zip                    both engines, plus zips
 *   node extension/build.mjs --target firefox         one engine
 *   node extension/build.mjs --server https://cue.example.com
 *
 * Two things make a build script necessary rather than optional.
 *
 * First, shared/ lives at the repo root and is served to the website and the
 * overlay from there. An extension cannot reach outside its own folder, so the
 * build copies shared/ in — one source of truth, three consumers.
 *
 * Second, Chromium and Firefox disagree about MV3 background scripts, and the
 * server origin has to be baked into host_permissions because an extension
 * cannot ask for a host it did not declare. Both are mechanical edits to one
 * manifest, which is exactly what a build step is for.
 *
 * The zip writer is hand-rolled so this stays dependency-free; the archives are
 * a handful of small text files, which is well inside what a minimal
 * store/deflate writer handles correctly.
 */
import { deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const srcDir = join(here, "src");
const sharedDir = join(repoRoot, "shared");

// ---- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};

const outDir = resolve(flag("out", join(here, "dist")));
const server = String(flag("server", process.env.PUBLIC_URL || "https://hoppy.ovh")).replace(/\/+$/, "");
const wantZip = argv.includes("--zip");
const target = flag("target", "all");

const TARGETS = {
	chrome: {
		label: "Chromium (Chrome, Edge, Brave, Opera)",
		patch(manifest) {
			// Chromium runs MV3 background as a service worker.
			manifest.background = { service_worker: "background.js", type: "module" };
		},
	},
	firefox: {
		label: "Firefox",
		patch(manifest) {
			// Firefox runs MV3 background as an event page. ES modules in background
			// scripts need 128+, so the floor is declared rather than discovered.
			manifest.background = { scripts: ["background.js"], type: "module" };
			manifest.browser_specific_settings = {
				gecko: { id: "cue@hoppy.ovh", strict_min_version: "128.0" },
			};
		},
	},
};

const targets = target === "all" ? Object.keys(TARGETS) : [target];
for (const t of targets) {
	if (!TARGETS[t]) {
		console.error(`unknown target "${t}" — expected chrome, firefox or all`);
		process.exit(1);
	}
}

// ---- build -----------------------------------------------------------------

const serverOrigin = (() => {
	try {
		return new URL(server).origin;
	} catch {
		console.error(`--server must be a full URL, got "${server}"`);
		process.exit(1);
	}
})();

function build(name) {
	const dest = join(outDir, name);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });

	// Everything in src/ except the manifest, which is generated below.
	for (const entry of readdirSync(srcDir)) {
		if (entry === "manifest.json") continue;
		cpSync(join(srcDir, entry), join(dest, entry), { recursive: true });
	}

	cpSync(sharedDir, join(dest, "shared"), { recursive: true });

	writeFileSync(
		join(dest, "config.generated.js"),
		`// Written by extension/build.mjs — edit build.mjs or pass --server, not this file.\n` +
			`export const DEFAULT_SERVER = ${JSON.stringify(server)};\n`
	);

	const manifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf8"));
	manifest.host_permissions = manifest.host_permissions.map((p) =>
		p.replace("__SERVER_ORIGIN__", serverOrigin)
	);
	TARGETS[name].patch(manifest);
	writeFileSync(join(dest, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);

	const files = walk(dest);
	console.log(`  ${name.padEnd(8)} ${TARGETS[name].label}`);
	console.log(`  ${" ".repeat(8)} ${relative(repoRoot, dest)} · ${files.length} files`);

	if (wantZip) {
		const zipPath = join(outDir, `${name}.zip`);
		writeFileSync(zipPath, makeZip(dest, files));
		console.log(`  ${" ".repeat(8)} ${relative(repoRoot, zipPath)} · ${(statSync(zipPath).size / 1024).toFixed(0)} kB`);
	}
}

function walk(dir, base = dir, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, base, found);
		else found.push(relative(base, full).split("\\").join("/"));
	}
	return found;
}

// ---- minimal zip writer ----------------------------------------------------

const crc32 =
	typeof nodeCrc32 === "function"
		? (buf) => nodeCrc32(buf)
		: (() => {
				const table = Array.from({ length: 256 }, (_, n) => {
					let c = n;
					for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
					return c >>> 0;
				});
				return (buf) => {
					let c = 0xffffffff;
					for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
					return (c ^ 0xffffffff) >>> 0;
				};
			})();

/** DOS date/time. Fixed, so an unchanged build produces an identical archive. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

function makeZip(root, names) {
	const locals = [];
	const centrals = [];
	let offset = 0;

	for (const name of names) {
		const raw = readFileSync(join(root, name));
		const deflated = deflateRawSync(raw, { level: 9 });
		// Storing is smaller than deflating for tiny or already-compressed files.
		const stored = deflated.length >= raw.length;
		const data = stored ? raw : deflated;
		const method = stored ? 0 : 8;
		const nameBuf = Buffer.from(name, "utf8");
		const sum = crc32(raw);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(sum, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, nameBuf, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(sum, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(0, 38); // external attributes
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);

		offset += local.length + nameBuf.length + data.length;
	}

	const centralBuf = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(names.length, 8);
	end.writeUInt16LE(names.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);

	return Buffer.concat([...locals, centralBuf, end]);
}

// ---- go --------------------------------------------------------------------

console.log(`Building the extension against ${serverOrigin}`);
mkdirSync(outDir, { recursive: true });
for (const name of targets) build(name);
console.log(
	wantZip
		? "\nDone. The server offers these zips at /downloads/chrome and /downloads/firefox."
		: "\nDone. Load the folder unpacked, or re-run with --zip to package it."
);
