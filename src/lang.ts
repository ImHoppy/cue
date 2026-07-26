import type { FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_LANG, LANGS, normalizeLang, translate } from "../shared/i18n.js";

export type Lang = string;

export { LANGS, DEFAULT_LANG };

function fromHeader(header?: string): Lang | null {
	if (!header) return null;
	const ranked = header
		.split(",")
		.map((part) => {
			const [tag, ...params] = part.trim().split(";");
			const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
			const weight = q ? Number.parseFloat(q.slice(2)) : 1;
			return { tag, weight: Number.isFinite(weight) ? weight : 0 };
		})
		.filter((entry) => entry.weight > 0)
		.sort((a, b) => b.weight - a.weight);

	for (const entry of ranked) {
		const match = normalizeLang(entry.tag);
		if (match) return match;
	}
	return null;
}

export function pickLang(req: FastifyRequest): Lang {
	const query = (req.query as { lang?: string } | undefined)?.lang;
	return (
		normalizeLang(query) ??
		normalizeLang(req.cookies?.lang) ??
		fromHeader(req.headers["accept-language"]) ??
		DEFAULT_LANG
	);
}

export const say = (lang: Lang, key: string, vars?: Record<string, unknown>) =>
	translate(lang, key, vars);

export function sendPage(reply: FastifyReply, body: string, lang: Lang) {
	return reply
		.type("text/html; charset=utf-8")
		.header("cache-control", "private, no-cache")
		.header("vary", "accept-language, cookie")
		.send(body.replace('<html lang="en">', `<html lang="${lang}" data-lang="${lang}">`));
}
