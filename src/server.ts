import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
	cookieSecret,
	host,
	overlayDir,
	port,
	publicDir,
	publicUrl,
	sharedDir,
	spotifyEnabled,
	spotifyRedirectUri,
} from "./config.js";
import { readKeyIsLive } from "./db.js";
import { hubStats, startHubTimers } from "./hubs.js";
import { pickLang, say } from "./lang.js";
import { registerAccount } from "./routes/account.js";
import { registerAdmin } from "./routes/admin.js";
import { registerPages } from "./routes/pages.js";
import { registerPresence } from "./routes/presence.js";
import { registerSpotify } from "./routes/spotify.js";
import { registerStream } from "./routes/stream.js";
import { startSpotifyPoller } from "./spotify-poll.js";

const app = Fastify({
	logger: { level: process.env.LOG_LEVEL ?? "info" },
	trustProxy: true,
	bodyLimit: 64 * 1024,
	// SSE streams sit idle between anchors; the 72s default would cut them.
	keepAliveTimeout: 15 * 60 * 1000,
});

await app.register(cookie, { secret: cookieSecret });
await app.register(formbody);
await app.register(rateLimit, {
	global: false,
	keyGenerator: (req) => req.headers.authorization ?? req.ip,
});

// shared/ is served to the overlay, the website and the extension alike. It is
// the same code in all three, and public in all three.
await app.register(fastifyStatic, { root: sharedDir, prefix: "/shared/", index: false });
await app.register(fastifyStatic, {
	root: overlayDir,
	prefix: "/overlay/",
	index: false,
	decorateReply: false,
});
await app.register(fastifyStatic, {
	root: publicDir,
	prefix: "/assets/",
	index: false,
	decorateReply: false,
});

app.get("/healthz", async () => ({ ok: true, ...hubStats() }));

const unknownKey = (req: FastifyRequest, reply: FastifyReply) => {
	const lang = pickLang(req);
	return reply
		.code(404)
		.type("text/html; charset=utf-8")
		.send(
			`<h1>${say(lang, "server.overlayNotFound.title")}</h1>` +
				`<p>${say(lang, "server.overlayNotFound.body")}</p>`
		);
};

// index.html loads /shared/* by absolute path, so it can be served from either
// spelling of the overlay URL without breaking its own asset paths.
app.get<{ Querystring: { key?: string } }>("/overlay", async (req, reply) => {
	const key = req.query.key;
	if (!key || !readKeyIsLive(key)) return unknownKey(req, reply);
	return reply.sendFile("index.html", overlayDir);
});

app.get<{ Querystring: { key?: string } }>("/overlay/", async (req, reply) => {
	const key = req.query.key;
	if (!key || !readKeyIsLive(key)) return unknownKey(req, reply);
	return reply.sendFile("index.html", overlayDir);
});

registerPages(app);
registerAccount(app);
registerPresence(app);
registerSpotify(app);
registerStream(app);
registerAdmin(app);

startHubTimers();
startSpotifyPoller(app.log);

await app.listen({ port, host });
app.log.info(`site: ${publicUrl}`);
if (spotifyEnabled) app.log.info(`spotify redirect uri: ${spotifyRedirectUri}`);
