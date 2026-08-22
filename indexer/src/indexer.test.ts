// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../../src/domain/grants.js";
import { decodeNativeEvent } from "./event-codec.js";
import { EvidenceStore } from "./evidence-store.js";
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
  it("recovers the last valid backup after a torn JSON write", async () => { const store = await storeFixture(); const path = (store as unknown as { filePath: string }).filePath; store.setCursor("safe-cursor"); await store.save(); store.setCursor("new-cursor"); await store.save(); await writeFile(path, "{broken", "utf8"); const restarted = new EventStore(path); await restarted.load(); expect(restarted.snapshot().cursor).toBe("safe-cursor"); });
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
  it("returns 503 readiness until the poller is caught up", async () => { const store = await storeFixture(); const api = createIndexerServer({ store, allowedOrigins: [], rateLimitPerMinute: 20, health: () => ({ ready: false, lagLedgers: 50 }) }); await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve)); cleanups.push(() => new Promise<void>((resolve) => api.server.close(() => resolve()))); const port = (api.server.address() as AddressInfo).port; const response = await fetch(`http://127.0.0.1:${port}/ready`); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ status: "not_ready", lagLedgers: 50 }); });
  it("stores only the five documented Level 5 aggregate events", async () => {
    const store = await storeFixture();
    const api = createIndexerServer({ store, allowedOrigins: [], rateLimitPerMinute: 20, health: () => ({ ready: true }) });
    await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => api.server.close(() => resolve())));
    const port = (api.server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const post = (event: string) => fetch(`${base}/api/v1/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, wallet: "must-not-be-stored" }),
    });

    for (const event of [
      "onboarding_role_selected",
      "onboarding_wallet_ready",
      "onboarding_action_started",
      "onboarding_action_confirmed",
      "feedback_opened",
    ]) {
      expect((await post(event)).status).toBe(204);
    }
    expect((await post("project_viewed")).status).toBe(400);
    expect((await post("onboarding_started")).status).toBe(400);
    expect((await post("feedback_submitted")).status).toBe(400);
    expect((await post("full_wallet_address")).status).toBe(400);
    expect(await fetch(`${base}/api/v1/metrics`).then((response) => response.json())).toMatchObject({
      events: {
        onboarding_role_selected: { count: 1 },
        onboarding_wallet_ready: { count: 1 },
        onboarding_action_started: { count: 1 },
        onboarding_action_confirmed: { count: 1 },
        feedback_opened: { count: 1 },
      },
    });
    expect(store.snapshot().metrics).not.toHaveProperty("wallet");
    expect(store.snapshot().metrics).not.toHaveProperty("project_viewed");
    expect(store.snapshot().metrics).not.toHaveProperty("onboarding_started");
  });
  it("hash-verifies metadata and evidence before serving downloads", async () => { const store = await storeFixture(); const directory = await mkdtemp(join(tmpdir(), "starpost-evidence-")); cleanups.push(() => rm(directory, { recursive: true, force: true })); const evidenceStore = new EvidenceStore(directory, 1024); await evidenceStore.initialize(); const api = createIndexerServer({ store, evidenceStore, allowedOrigins: [], rateLimitPerMinute: 50, health: () => ({ ready: true }) }); await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve)); cleanups.push(() => new Promise<void>((resolve) => api.server.close(() => resolve()))); const port = (api.server.address() as AddressInfo).port; const base = `http://127.0.0.1:${port}`; const metadata = { schema: "starpost.evidence/1", title: "Receipt" }; const canonical = '{"schema":"starpost.evidence/1","title":"Receipt"}'; const metadataHash = createHash("sha256").update(canonical).digest("hex"); expect((await fetch(`${base}/api/v1/metadata/${metadataHash}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) })).status).toBe(201); expect(await fetch(`${base}/api/v1/metadata/${metadataHash}`).then((response) => response.json())).toEqual(metadata); const bytes = new TextEncoder().encode("public proof"); const contentHash = createHash("sha256").update(bytes).digest("hex"); const reservation = await fetch(`${base}/api/v1/evidence/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentHash, metadataHash, mediaType: "text/plain", size: bytes.length }) }).then((response) => response.json()) as { uploadUrl: string }; expect((await fetch(`${base}${reservation.uploadUrl}`, { method: "PUT", headers: { "Content-Type": "text/plain", "X-Content-SHA256": contentHash }, body: bytes })).status).toBe(201); const download = await fetch(`${base}/api/v1/evidence/${contentHash}`); expect(download.headers.get("content-disposition")).toContain("attachment"); expect(await download.text()).toBe("public proof"); });
});
