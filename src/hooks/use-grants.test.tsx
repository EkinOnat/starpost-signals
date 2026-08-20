import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrantView } from "../domain/grants";
import type { DiscoveryResult } from "../lib/registry-discovery";

const config = { indexerUrl: "" };

vi.mock("../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config")>();
  return {
    ...actual,
    get INDEXER_URL() {
      return config.indexerUrl;
    },
  };
});
vi.mock("../lib/events", () => ({ fetchActivityEvents: vi.fn() }));
vi.mock("../lib/grant-client", () => ({ readGrantView: vi.fn() }));
vi.mock("../lib/registry-discovery", () => ({ discoverRegistryGrants: vi.fn() }));

const { fetchActivityEvents } = await import("../lib/events");
const { discoverRegistryGrants } = await import("../lib/registry-discovery");
const { useGrants } = await import("./use-grants");

const SYNCED_LEDGER = 4_213_405;

function persisted(patch: Partial<GrantView> = {}): GrantView {
  return {
    id: 1,
    title: "Starpost Climate Receipts",
    description: "Persisted registry state.",
    category: "Climate",
    creator: "GAMTIIKC",
    asset: "XLM",
    goal: 100,
    raised: 100,
    deadline: "2027-01-15T00:00:00.000Z",
    approvalBps: 6000,
    quorumBps: 5000,
    status: "active",
    currentMilestone: 1,
    syncedLedger: SYNCED_LEDGER,
    milestones: [
      { index: 0, title: "Public receipt prototype", amount: 40, yesWeight: 100, noWeight: 0, status: "released" },
      { index: 1, title: "Field verification launch", amount: 60, yesWeight: 0, noWeight: 0, status: "voting" },
    ],
    ...patch,
  };
}

function discovery(patch: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    grants: [persisted()],
    missingIds: [],
    failedIds: [],
    syncedLedger: SYNCED_LEDGER,
    source: "allocator",
    ...patch,
  };
}

beforeEach(() => {
  config.indexerUrl = "";
  vi.mocked(fetchActivityEvents).mockResolvedValue({ cursor: "cursor-1", events: [] });
  vi.mocked(discoverRegistryGrants).mockResolvedValue(discovery());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGrants discovery", () => {
  it("loads persisted grants when the RPC event snapshot is empty", async () => {
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grants).toHaveLength(1));
    expect(result.current.events).toHaveLength(0);
    expect(result.current.grants[0]).toMatchObject({ id: 1, raised: 100, status: "active" });
    expect(result.current.grantsStatus).toBe("ready");
  });

  it("loads persisted grants when the indexer is unavailable", async () => {
    config.indexerUrl = "https://indexer.test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grants).toHaveLength(1));
    expect(result.current.grants[0].title).toBe("Starpost Climate Receipts");
    expect(result.current.grantsStatus).toBe("ready");
  });

  it("lets direct contract state override a stale indexer snapshot", async () => {
    config.indexerUrl = "https://indexer.test";
    const stale: GrantView = persisted({ raised: 40, status: "funding", currentMilestone: 0, syncedLedger: undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/grants")
          ? { ok: true, json: async () => ({ grants: [stale] }) }
          : { ok: true, json: async () => ({ events: [], cursor: "cursor-1", lastEventId: null }) },
      ),
    );
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grants).toHaveLength(1));
    await waitFor(() => expect(result.current.grants[0].raised).toBe(100));
    expect(result.current.grants[0].status).toBe("active");
  });

  it("reports an error state instead of an empty dashboard when reads fail", async () => {
    vi.mocked(discoverRegistryGrants).mockResolvedValue(discovery({ grants: [], failedIds: [1, 2], syncedLedger: null }));
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grantsStatus).toBe("error"));
    expect(result.current.grants).toEqual([]);
  });

  it("reports an error state when discovery itself throws", async () => {
    vi.mocked(discoverRegistryGrants).mockRejectedValue(new Error("rpc unreachable"));
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grantsStatus).toBe("error"));
  });

  it("recovers persisted grants when the retry action succeeds", async () => {
    vi.mocked(discoverRegistryGrants).mockResolvedValueOnce(discovery({ grants: [], failedIds: [1] }));
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grantsStatus).toBe("error"));
    result.current.retryRegistryRead();
    await waitFor(() => expect(result.current.grantsStatus).toBe("ready"));
    expect(result.current.grants).toHaveLength(1);
  });

  it("does not replay an event already materialized by the contract read", async () => {
    const { result } = renderHook(() => useGrants());
    await waitFor(() => expect(result.current.grants).toHaveLength(1));
    result.current.applyEvent({
      id: "replayed",
      kind: "ContributionMade",
      contractId: "CESCROW",
      grantId: 1,
      amount: 100,
      txHash: "hash",
      ledger: SYNCED_LEDGER - 10,
      closedAt: "2026-08-10T00:00:00.000Z",
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.grants[0].raised).toBe(100);
  });
});
