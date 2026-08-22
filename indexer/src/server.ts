import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ActivityEvent } from "../../src/domain/grants.js";
import type { EvidenceStore } from "./evidence-store.js";
import type { IndexedContractEvent } from "./event-codec.js";
import type { EventStore } from "./store.js";

type ServerOptions = {
  store: EventStore;
  evidenceStore?: EvidenceStore;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  health: () => Record<string, unknown>;
  release?: string;
};

const ANALYTICS_EVENTS = new Set([
  "onboarding_started",
  "onboarding_role_selected",
  "onboarding_wallet_ready",
  "onboarding_action_started",
  "onboarding_action_confirmed",
  "feedback_opened",
  "wallet_connection_attempted",
  "wallet_connected",
  "wallet_connection_failed",
  "project_viewed",
  "project_created",
  "contribution_started",
  "contribution_confirmed",
  "evidence_submission_started",
  "evidence_submitted",
  "reviewer_attestation_confirmed",
  "milestone_vote_confirmed",
  "dispute_opened",
  "payout_confirmed",
  "refund_confirmed",
]);

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage, maximum: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > maximum) throw new Error("body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function pageAfter<T extends { id: string }>(items: T[], after: string | null, limit: number) {
  const offset = after ? Math.max(0, items.findIndex((item) => item.id === after) + 1) : 0;
  return items.slice(offset, offset + limit);
}

function errorStatus(error: unknown) {
  const name = error instanceof Error ? error.message : "request_failed";
  if (["invalid_hash", "invalid_media_type", "invalid_size", "upload_mismatch", "metadata_too_large"].includes(name)) return 400;
  if (["hash_mismatch"].includes(name)) return 422;
  if (["upload_expired"].includes(name)) return 404;
  if (name === "body_too_large") return 413;
  return 500;
}

export function createIndexerServer(options: ServerOptions) {
  const activityClients = new Set<ServerResponse>();
  const contractClients = new Set<ServerResponse>();
  const rates = new Map<string, { count: number; resetAt: number }>();
  const startedAt = Date.now();

  const server = createServer((request: IncomingMessage, response) => {
    void (async () => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      response.setHeader("Cache-Control", "no-store");
      const origin = request.headers.origin;
      if (origin && options.allowedOrigins.includes(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Content-SHA256,Last-Event-ID");
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
      const next = !rate || rate.resetAt <= now
        ? { count: 1, resetAt: now + 60_000 }
        : { ...rate, count: rate.count + 1 };
      rates.set(ip, next);
      if (next.count > options.rateLimitPerMinute) {
        json(response, 429, { error: "rate_limit_exceeded" });
        return;
      }

      const url = new URL(request.url || "/", "http://localhost");
      const snapshot = options.store.snapshot();
      const health = options.health();
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          status: "ok",
          release: options.release ?? "development",
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
          cursor: snapshot.cursor,
          updatedAt: snapshot.updatedAt,
          ...health,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        const ready = health.ready === true;
        json(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", ...health });
        return;
      }

      if (request.method === "GET" && ["/api/events", "/api/v1/events"].includes(url.pathname)) {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
        const events = pageAfter(snapshot.events, url.searchParams.get("after"), limit);
        json(response, 200, {
          schemaVersion: 1,
          events,
          cursor: snapshot.cursor,
          next: events.at(-1)?.id ?? null,
          lastEventId: snapshot.events[0]?.id ?? null,
        });
        return;
      }
      if (request.method === "GET" && ["/api/grants", "/api/v1/grants"].includes(url.pathname)) {
        json(response, 200, { schemaVersion: 1, grants: snapshot.grants, updatedAt: snapshot.updatedAt, cursor: snapshot.cursor });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/contract-events") {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
        const projectId = url.searchParams.get("projectId");
        const filtered = projectId === null
          ? snapshot.contractEvents
          : snapshot.contractEvents.filter((event) => event.topics.some((topic) => String(topic) === projectId));
        const events = pageAfter(filtered, url.searchParams.get("after"), limit);
        json(response, 200, { schemaVersion: 1, events, next: events.at(-1)?.id ?? null, cursor: snapshot.cursor });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/metrics") {
        json(response, 200, { schemaVersion: 1, release: options.release ?? "development", events: snapshot.metrics });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/telemetry") {
        const value = JSON.parse((await body(request, 8 * 1024)).toString("utf8")) as { event?: string };
        if (!value.event || !ANALYTICS_EVENTS.has(value.event)) {
          json(response, 400, { error: "invalid_analytics_event" });
          return;
        }
        options.store.recordMetric(value.event);
        await options.store.save();
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "GET" && ["/api/stream", "/api/v1/stream"].includes(url.pathname)) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        });
        response.write(": connected\n\n");
        const after = request.headers["last-event-id"] || url.searchParams.get("after");
        if (after) {
          const index = snapshot.events.findIndex((event) => event.id === after);
          if (index > 0) {
            for (const event of snapshot.events.slice(0, index).reverse()) {
              response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
            }
          }
        }
        activityClients.add(response);
        request.on("close", () => activityClients.delete(response));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/contract-stream") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        });
        response.write(": connected\n\n");
        contractClients.add(response);
        request.on("close", () => contractClients.delete(response));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/evidence/uploads" && options.evidenceStore) {
        const input = JSON.parse((await body(request, 16 * 1024)).toString("utf8")) as {
          contentHash: string;
          metadataHash: string;
          mediaType: string;
          size: number;
        };
        json(response, 201, options.evidenceStore.reserve(input));
        return;
      }
      const uploadMatch = url.pathname.match(/^\/api\/v1\/evidence\/uploads\/([0-9a-f-]+)$/i);
      if (request.method === "PUT" && uploadMatch && options.evidenceStore) {
        const bytes = await body(request, options.evidenceStore.maxBytes);
        const result = await options.evidenceStore.storeUpload(
          uploadMatch[1],
          bytes,
          String(request.headers["content-type"] ?? ""),
          String(request.headers["x-content-sha256"] ?? ""),
        );
        json(response, 201, result);
        return;
      }
      const metadataMatch = url.pathname.match(/^\/api\/v1\/metadata\/([0-9a-f]{64})$/i);
      if (request.method === "PUT" && metadataMatch && options.evidenceStore) {
        const value = JSON.parse((await body(request, 64 * 1024)).toString("utf8")) as unknown;
        await options.evidenceStore.storeMetadata(metadataMatch[1].toLowerCase(), value);
        json(response, 201, { hash: metadataMatch[1].toLowerCase() });
        return;
      }
      if (request.method === "GET" && metadataMatch && options.evidenceStore) {
        const value = await options.evidenceStore.readMetadata(metadataMatch[1].toLowerCase());
        if (value === null) json(response, 404, { error: "not_found" });
        else json(response, 200, value);
        return;
      }
      const evidenceMatch = url.pathname.match(/^\/api\/v1\/evidence\/([0-9a-f]{64})$/i);
      if (request.method === "GET" && evidenceMatch && options.evidenceStore) {
        const stored = await options.evidenceStore.readEvidence(evidenceMatch[1].toLowerCase());
        if (!stored) {
          json(response, 404, { error: "not_found" });
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", stored.mediaType);
        response.setHeader("Content-Disposition", `attachment; filename="evidence-${evidenceMatch[1].slice(0, 12)}"`);
        response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.end(stored.bytes);
        return;
      }

      json(response, 404, { error: "not_found" });
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : "request_failed";
      json(response, errorStatus(error), { error: message });
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of [...activityClients, ...contractClients]) client.write(": heartbeat\n\n");
  }, 15_000);
  server.on("close", () => clearInterval(heartbeat));

  return {
    server,
    broadcast(event: ActivityEvent) {
      const frame = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of activityClients) client.write(frame);
    },
    broadcastContract(event: IndexedContractEvent) {
      const frame = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of contractClients) client.write(frame);
    },
    clientCount: () => activityClients.size + contractClients.size,
  };
}
