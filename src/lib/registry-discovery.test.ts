import { describe, expect, it, vi } from "vitest";
import type { GrantView } from "../domain/grants";

// Every port is injected below; stubbing the client keeps this a pure unit test
// and avoids pulling the wallet bundle into the module graph.
vi.mock("./grant-client", () => ({
  grantExists: vi.fn(),
  isMissingGrantError: vi.fn(),
  readGrantView: vi.fn(),
  readLatestLedger: vi.fn(),
  readRegistryNextGrantId: vi.fn(),
}));

const { discoverRegistryGrants } = await import("./registry-discovery");
type DiscoveryPorts = import("./registry-discovery").DiscoveryPorts;

function grant(id: number, patch: Partial<GrantView> = {}): GrantView {
  return {
    id,
    title: `Grant #${id}`,
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
    milestones: [
      { index: 0, title: "Prototype", amount: 40, yesWeight: 100, noWeight: 0, status: "released" },
      { index: 1, title: "Launch", amount: 60, yesWeight: 0, noWeight: 0, status: "voting" },
    ],
    ...patch,
  };
}

class MissingGrant extends Error {}

function ports(overrides: Partial<DiscoveryPorts> = {}): DiscoveryPorts {
  return {
    readNextGrantId: vi.fn().mockResolvedValue(2),
    grantExists: vi.fn().mockResolvedValue(true),
    readGrant: vi.fn(async (id: number) => grant(id)),
    readLatestLedger: vi.fn().mockResolvedValue(4_213_405),
    isMissingGrant: (error: unknown) => error instanceof MissingGrant,
    ...overrides,
  };
}

describe("registry discovery", () => {
  it("enumerates grants from the contract allocator without any event input", async () => {
    const readGrant = vi.fn(async (id: number) => grant(id));
    const result = await discoverRegistryGrants({}, ports({ readNextGrantId: vi.fn().mockResolvedValue(3), readGrant }));
    expect(result.source).toBe("allocator");
    expect(result.grants.map((item) => item.id)).toEqual([2, 1]);
    expect(readGrant).toHaveBeenCalledTimes(2);
    expect(result.failedIds).toEqual([]);
  });

  it("stamps the read ledger so materialized state is not replayed", async () => {
    const result = await discoverRegistryGrants({}, ports({ readLatestLedger: vi.fn().mockResolvedValue(4_213_405) }));
    expect(result.grants[0].syncedLedger).toBe(4_213_405);
    expect(result.syncedLedger).toBe(4_213_405);
  });

  it("reads nothing when the allocator reports an empty registry", async () => {
    const readGrant = vi.fn();
    const result = await discoverRegistryGrants({}, ports({ readNextGrantId: vi.fn().mockResolvedValue(1), readGrant }));
    expect(result.grants).toEqual([]);
    expect(result.failedIds).toEqual([]);
    expect(readGrant).not.toHaveBeenCalled();
  });

  it("deduplicates ids already known from events or the indexer", async () => {
    const readGrant = vi.fn(async (id: number) => grant(id));
    const result = await discoverRegistryGrants(
      { knownIds: [1, 1, 2] },
      ports({ readNextGrantId: vi.fn().mockResolvedValue(3), readGrant }),
    );
    expect(result.grants.map((item) => item.id)).toEqual([2, 1]);
    expect(readGrant).toHaveBeenCalledTimes(2);
  });

  it("still reads an event-only id that the allocator range does not cover", async () => {
    const result = await discoverRegistryGrants(
      { knownIds: [7] },
      ports({ readNextGrantId: vi.fn().mockResolvedValue(2) }),
    );
    expect(result.grants.map((item) => item.id)).toEqual([7, 1]);
  });

  it("skips a missing id without hiding valid later grants", async () => {
    const readGrant = vi.fn(async (id: number) => {
      if (id === 2) throw new MissingGrant("GrantNotFound");
      return grant(id);
    });
    const result = await discoverRegistryGrants({}, ports({ readNextGrantId: vi.fn().mockResolvedValue(5), readGrant }));
    expect(result.missingIds).toEqual([2]);
    expect(result.grants.map((item) => item.id)).toEqual([4, 3, 1]);
    expect(result.failedIds).toEqual([]);
  });

  it("separates an RPC failure from a missing id", async () => {
    const readGrant = vi.fn(async (id: number) => {
      if (id === 1) throw new Error("503 upstream unavailable");
      if (id === 2) throw new MissingGrant("GrantNotFound");
      return grant(id);
    });
    const result = await discoverRegistryGrants({}, ports({ readNextGrantId: vi.fn().mockResolvedValue(4), readGrant }));
    expect(result.failedIds).toEqual([1]);
    expect(result.missingIds).toEqual([2]);
    expect(result.grants.map((item) => item.id)).toEqual([3]);
  });

  it("reports a total RPC outage as failed ids rather than an empty registry", async () => {
    const result = await discoverRegistryGrants(
      { maxGrantId: 8, concurrency: 2 },
      ports({
        readNextGrantId: vi.fn().mockResolvedValue(9),
        readGrant: vi.fn().mockRejectedValue(new Error("fetch failed")),
      }),
    );
    expect(result.grants).toEqual([]);
    expect(result.failedIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("falls back to a bounded probe when the allocator cannot be read", async () => {
    const grantExists = vi.fn(async (id: number) => id === 2);
    const readGrant = vi.fn(async (id: number) => grant(id));
    const result = await discoverRegistryGrants(
      { maxGrantId: 6, concurrency: 3 },
      ports({ readNextGrantId: vi.fn().mockRejectedValue(new Error("instance unreadable")), grantExists, readGrant }),
    );
    expect(result.source).toBe("probe");
    expect(grantExists).toHaveBeenCalledTimes(6);
    expect(result.grants.map((item) => item.id)).toEqual([2]);
    expect(readGrant).toHaveBeenCalledTimes(1);
  });

  it("never probes past the documented maximum grant id", async () => {
    const grantExists = vi.fn().mockResolvedValue(false);
    const result = await discoverRegistryGrants(
      { maxGrantId: 5, concurrency: 5 },
      ports({ readNextGrantId: vi.fn().mockResolvedValue(null), grantExists }),
    );
    expect(grantExists).toHaveBeenCalledTimes(5);
    expect(result.grants).toEqual([]);
  });

  it("caps allocator enumeration at the configured maximum", async () => {
    const readGrant = vi.fn(async (id: number) => grant(id));
    await discoverRegistryGrants(
      { maxGrantId: 3 },
      ports({ readNextGrantId: vi.fn().mockResolvedValue(500), readGrant }),
    );
    expect(readGrant).toHaveBeenCalledTimes(3);
  });

  it("carries existing copy into the refreshed view", async () => {
    const readGrant = vi.fn(async (id: number, current?: GrantView) => grant(id, { description: current?.description ?? "fallback" }));
    const result = await discoverRegistryGrants(
      { current: [grant(1, { description: "Operator written summary." })] },
      ports({ readNextGrantId: vi.fn().mockResolvedValue(2), readGrant }),
    );
    expect(result.grants[0].description).toBe("Operator written summary.");
  });
});
