// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../../src/domain/grants.js";
import { decodeNativeEvent } from "./event-codec.js";
import { EventIndexer, type ActivitySource } from "./poller.js";
import { createIndexerServer } from "./server.js";
import { EventStore } from "./store.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function native(kind: string, patch: Partial<Parameters<typeof decodeNativeEvent>[0]> = {}) {
  return decodeNativeEvent({ id: "evt-1", contractId: "CAAA", topics: [kind, 7], value: {}, txHash: "tx", ledger: 99, closedAt: "2026-08-10T00:00:00Z", ...patch });
}

function activity(patch: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id: "evt-1", kind: "GrantCreated", contractId: "CAAA", grantId: 7, category: "Climate", actor: "GABC", title: "Solar proof", amount: 1000, txHash: "tx", ledger: 99, closedAt: "2026-08-10T00:00:00Z", ...patch };
}

async function storeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "starpost-indexer-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const store = new EventStore(join(dir, "state.json"));
  await store.load();
  return store;
}

describe("event decoding", () => {
  it("decodes a grant category and goal", () => expect(native("grant_created", { topics: ["grant_created", 7, 2], value: { title: "Solar", goal: 10_000_000_000, creator: "GCREATOR" } })).toMatchObject({ kind: "GrantCreated", grantId: 7, category: "Climate", amount: 1000 }));
  it("decodes a weighted milestone vote", () => expect(native("milestone_vote_cast", { topics: ["milestone_vote_cast", 7, 1], value: { voter: "GVOTER", approve: true, weight: 2_500_000_000 } })).toMatchObject({ kind: "MilestoneVoteCast", milestone: 1, approve: true, amount: 250 }));
  it("ignores malformed or unknown events", () => expect(native("unknown_event")).toBeNull());
});

describe("persistent event store", () => {
  it("persists and restores its cursor", async () => { const store = await storeFixture(); store.setCursor("cursor-7"); await store.save(); const restarted = new EventStore((store as unknown as { filePath: string }).filePath); await restarted.load(); expect(restarted.snapshot().cursor).toBe("cursor-7"); });
  it("rejects duplicate event IDs", async () => { const store = await storeFixture(); expect(store.ingest(activity())).toBe(true); expect(store.ingest(activity())).toBe(false); expect(store.snapshot().events).toHaveLength(1); });
  it("materializes grant contribution totals", async () => { const store = await storeFixture(); store.ingest(activity()); store.ingest(activity({ id: "evt-2", kind: "ContributionMade", amount: 100, total: 100 })); expect(store.snapshot().grants[0].raised).toBe(100); });
});

describe("indexer polling", () => {
  it("backfills, broadcasts, and advances the cursor", async () => { const store = await storeFixture(); const source: ActivitySource = { page: vi.fn().mockResolvedValue({ cursor: "next", events: [activity()] }) }; const broadcast = vi.fn(); const indexer = new EventIndexer(source, store, 1000, broadcast, vi.fn()); expect(await indexer.tick()).toBe(1); expect(broadcast).toHaveBeenCalledOnce(); expect(store.snapshot().cursor).toBe("next"); });
  it("deduplicates replayed pages after restart", async () => { const store = await storeFixture(); store.ingest(activity()); const source: ActivitySource = { page: vi.fn().mockResolvedValue({ cursor: "next", events: [activity()] }) }; const indexer = new EventIndexer(source, store, 1000, vi.fn(), vi.fn()); expect(await indexer.tick()).toBe(0); });
});

describe("HTTP and SSE API", () => {
  it("serves health, grants, security headers, and strict CORS", async () => { const store = await storeFixture(); store.ingest(activity()); const api = createIndexerServer({ store, allowedOrigins: ["https://starpost-signals.vercel.app"], rateLimitPerMinute: 20, health: () => ({ lastLedger: 99 }) }); await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve)); cleanups.push(() => new Promise<void>((resolve) => api.server.close(() => resolve()))); const port = (api.server.address() as AddressInfo).port; const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: "https://starpost-signals.vercel.app" } }); expect(await health.json()).toMatchObject({ status: "ok", lastLedger: 99 }); expect(health.headers.get("x-content-type-options")).toBe("nosniff"); expect(health.headers.get("access-control-allow-origin")).toBe("https://starpost-signals.vercel.app"); const grants = await fetch(`http://127.0.0.1:${port}/api/grants`).then((response) => response.json()) as { grants: unknown[] }; expect(grants.grants).toHaveLength(1); });
  it("registers and broadcasts to an SSE client", async () => { const store = await storeFixture(); const api = createIndexerServer({ store, allowedOrigins: [], rateLimitPerMinute: 20, health: () => ({}) }); await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve)); cleanups.push(() => new Promise<void>((resolve) => api.server.close(() => resolve()))); const port = (api.server.address() as AddressInfo).port; const response = await fetch(`http://127.0.0.1:${port}/api/stream`); const reader = response.body!.getReader(); await reader.read(); expect(api.clientCount()).toBe(1); api.broadcast(activity()); const chunk = new TextDecoder().decode((await reader.read()).value); expect(chunk).toContain("evt-1"); await reader.cancel(); });
});
