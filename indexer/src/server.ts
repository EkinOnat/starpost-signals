import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ActivityEvent } from "../../src/domain/grants.js";
import type { EventStore } from "./store.js";

type ServerOptions = {
  store: EventStore;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  health: () => Record<string, unknown>;
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
export function createIndexerServer(options: ServerOptions) {
  const clients = new Set<ServerResponse>();
  const rates = new Map<string, { count: number; resetAt: number }>();
  const startedAt = Date.now();

  const server = createServer((request: IncomingMessage, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (origin && options.allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.statusCode = origin && !options.allowedOrigins.includes(origin) ? 403 : 204;
      response.end();
      return;
    }

    const ip = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const rate = rates.get(ip);
    const next = !rate || rate.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { ...rate, count: rate.count + 1 };
    rates.set(ip, next);
    if (next.count > options.rateLimitPerMinute) {
      json(response, 429, { error: "rate_limit_exceeded" });
      return;
    }

    const url = new URL(request.url || "/", "http://localhost");
    const snapshot = options.store.snapshot();
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { status: "ok", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000), cursor: snapshot.cursor, updatedAt: snapshot.updatedAt, ...options.health() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      json(response, 200, { events: snapshot.events.slice(0, limit), cursor: snapshot.cursor });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/grants") {
      json(response, 200, { grants: snapshot.grants, updatedAt: snapshot.updatedAt });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "Cache-Control": "no-cache, no-transform",
      });
      response.write(": connected\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    json(response, 404, { error: "not_found" });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
  }, 15_000);
  server.on("close", () => clearInterval(heartbeat));

  return {
    server,
    broadcast(event: ActivityEvent) {
      const frame = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) client.write(frame);
    },
    clientCount: () => clients.size,
  };
}
