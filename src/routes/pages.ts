import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizeUrl, completeLogin, currentUser, isAdmin, logout } from "../auth.js";
import { authEnabled, downloadsDir, publicDir } from "../config.js";
import { BROWSERS } from "../../shared/contract.js";
import { pickLang, say, sendPage } from "../lang.js";
import { buildAvailable } from "./account.js";

const page = (name: string) => readFileSync(join(publicDir, name), "utf8");

const pages = {
	landing: page("index.html"),
	setup: page("setup.html"),
	dashboard: page("dashboard.html"),
	admin: page("admin.html"),
};

export function registerPages(app: FastifyInstance) {
	app.get("/", async (req, reply) => {
		const user = currentUser(req);
		if (!user) return sendPage(reply, pages.landing, pickLang(req));
		return reply.redirect(user.setup_done ? "/dashboard" : "/setup");
	});

	app.get("/setup", async (req, reply) => {
		if (!currentUser(req)) return reply.redirect("/");
		return sendPage(reply, pages.setup, pickLang(req));
	});

	app.get("/dashboard", async (req, reply) => {
		const user = currentUser(req);
		if (!user) return reply.redirect("/");
		if (!user.setup_done) return reply.redirect("/setup");
		return sendPage(reply, pages.dashboard, pickLang(req));
	});

	app.get("/admin", async (req, reply) => {
		if (!isAdmin(currentUser(req))) return reply.redirect("/");
		return sendPage(reply, pages.admin, pickLang(req));
	});

	// --- sign-in ------------------------------------------------------------

	app.get("/login", async (req, reply) => {
		if (!authEnabled) {
			const lang = pickLang(req);
			return sendPage(
				reply,
				`<html lang="en"><body><h1>${say(lang, "server.signInUnconfigured.title")}</h1>` +
					`<p>${say(lang, "server.signInUnconfigured.body")}</p></body></html>`,
				lang
			);
		}
		return reply.redirect(authorizeUrl(reply));
	});

	app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
		"/auth/callback",
		async (req, reply) => {
			const { code, state, error } = req.query;
			if (error || !code || !state) return reply.redirect("/?error=signin");
			const user = await completeLogin(req, reply, code, state);
			if (!user) return reply.redirect("/?error=signin");
			return reply.redirect(user.setup_done ? "/dashboard" : "/setup");
		}
	);

	app.post("/logout", async (_req, reply) => {
		logout(reply);
		return reply.redirect("/");
	});

	// --- extension downloads ------------------------------------------------

	app.get<{ Params: { target: string } }>("/downloads/:target", async (req, reply) => {
		const target = req.params.target;
		if (!BROWSERS.some((b: { id: string }) => b.id === target)) {
			return reply.code(404).send({ error: "unknown_target" });
		}
		if (!buildAvailable(target)) {
			return reply.code(404).send({
				error: "build_missing",
				hint: "Run `node extension/build.mjs --zip` on the server to produce the extension builds.",
			});
		}
		return reply
			.header("content-disposition", `attachment; filename="ytm-overlay-${target}.zip"`)
			.type("application/zip")
			.send(readFileSync(join(downloadsDir, `${target}.zip`)));
	});
}
