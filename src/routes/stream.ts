import type { FastifyInstance } from "fastify";
import { markOverlaySeen, readKeyIsLive } from "../db.js";
import { hubForRead, type Client } from "../hubs.js";

export function registerStream(app: FastifyInstance) {
	app.get<{ Querystring: { key?: string } }>("/api/stream", async (req, reply) => {
		const key = req.query.key;
		if (!key || !readKeyIsLive(key)) return reply.code(404).send({ error: "unknown_key" });

		// Hijack before writing, so Fastify does not also try to own the response.
		reply.hijack();

		const res = reply.raw;
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			// Belt and braces for proxies that buffer whatever their config says.
			"x-accel-buffering": "no",
		});
		res.write("retry: 2000\n\n");

		const client: Client = {
			send(event, data) {
				if (res.writableEnded) return;
				res.write(`event: ${event}\ndata: ${data}\n\n`);
			},
			comment() {
				if (res.writableEnded) return;
				res.write(":\n\n");
			},
			close() {
				if (!res.writableEnded) res.end();
			},
		};

		markOverlaySeen(key);

		const hub = hubForRead(key);
		hub.add(client);
		req.raw.on("close", () => hub.remove(client));
	});
}
