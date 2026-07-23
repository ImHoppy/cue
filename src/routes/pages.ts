import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizeUrl, completeLogin, currentUser, isAdmin, logout } from "../auth.js";
import { authEnabled, downloadsDir, publicDir } from "../config.js";
import { BROWSERS } from "../../shared/contract.js";
import { buildAvailable } from "./account.js";

const page = (name: string) => readFileSync(join(publicDir, name), "utf8");

const pages = {
	landing: page("index.html"),
	setup: page("setup.html"),
	dashboard: page("dashboard.html"),
	admin: page("admin.html"),
};

const html = (reply: import("fastify").FastifyReply, body: string) => reply.type("text/html; charset=utf-8").send(body);

export function registerPages(app: FastifyInstance) {
	app.get("/", async (req, reply) => {
		const user = currentUser(req);
		if (!user) return html(reply, pages.landing);
		return reply.redirect(user.setup_done ? "/dashboard" : "/setup");
	});

	app.get("/setup", async (req, reply) => {
		if (!currentUser(req)) return reply.redirect("/");
		return html(reply, pages.setup);
	});

	app.get("/dashboard", async (req, reply) => {
		const user = currentUser(req);
		if (!user) return reply.redirect("/");
		if (!user.setup_done) return reply.redirect("/setup");
		return html(reply, pages.dashboard);
	});

	app.get("/admin", async (req, reply) => {
		if (!isAdmin(currentUser(req))) return reply.redirect("/");
		return html(reply, pages.admin);
	});

	// --- sign-in ------------------------------------------------------------

	app.get("/login", async (_req, reply) => {
		if (!authEnabled) {
			return html(
				reply,
				"<h1>Sign-in is not configured</h1><p>Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET on the server.</p>"
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
