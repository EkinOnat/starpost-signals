import { describe, expect, it } from "vitest";
import {
  DEMO_GRANTS,
  applyActivitySnapshot,
  mergeAuthoritativeGrants,
  reduceActivity,
  validateGrant,
  type ActivityEvent,
  type CreateGrantInput,
  type GrantView,
} from "./grants";

const valid: CreateGrantInput = {
  category: "Climate",
  title: "Public impact receipts",
  description: "Build transparent receipts for verified community solar delivery.",
  goal: 100,
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  milestones: [{ title: "Prototype", amount: 40 }, { title: "Launch", amount: 60 }],
  approvalBps: 6000,
  quorumBps: 5000,
};

function event(patch: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: "1",
    kind: "GrantCreated",
    contractId: "CAAA",
    txHash: "abc",
    ledger: 1,
    closedAt: new Date().toISOString(),
    ...patch,
  };
}

describe("grant validation", () => {
  it("accepts an exact two-milestone schedule", () => expect(validateGrant(valid)).toEqual([]));
  it("rejects a milestone total that differs from the goal", () => expect(validateGrant({ ...valid, goal: 101 })).toContain("Milestone amounts must equal the funding goal."));
  it("rejects a past deadline", () => expect(validateGrant({ ...valid, deadline: "2020-01-01" })).toContain("Choose a future funding deadline."));
  it("requires two to five milestones", () => expect(validateGrant({ ...valid, milestones: [valid.milestones[0]] })).toContain("Use between two and five milestones."));
  it("rejects unsafe voting thresholds", () => expect(validateGrant({ ...valid, approvalBps: 4000, quorumBps: 500 })).toHaveLength(2));
});
describe("event reducer", () => {
  it("creates a materialized grant from GrantCreated", () => {
    const state = reduceActivity({ grants: [], events: [] }, event({ grantId: 9, category: "Gaming", title: "Open worlds", amount: 500 }));
    expect(state.grants[0]).toMatchObject({ id: 9, category: "Gaming", goal: 500 });
  });
  it("applies contribution totals", () => {
    const state = reduceActivity({ grants: DEMO_GRANTS, events: [] }, event({ id: "2", kind: "ContributionMade", grantId: 1, amount: 20, total: 1860 }));
    expect(state.grants.find((grant) => grant.id === 1)?.raised).toBe(1860);
  });
  it("suppresses duplicate event IDs", () => {
    const first = event({ grantId: 10 });
    const state = reduceActivity(reduceActivity({ grants: [], events: [] }, first), first);
    expect(state.events).toHaveLength(1);
  });
  it("orders an activity snapshot newest first", () => {
    const state = applyActivitySnapshot([], [event({ id: "old", ledger: 1 }), event({ id: "new", ledger: 2 })]);
    expect(state.events.map((item) => item.id)).toEqual(["new", "old"]);
  });
  it("marks a failed funding round", () => {
    const state = reduceActivity({ grants: DEMO_GRANTS, events: [] }, event({ id: "3", kind: "FundingFinalized", grantId: 1, funded: false }));
    expect(state.grants.find((grant) => grant.id === 1)?.status).toBe("failed");
  });
});

const persisted: GrantView = {
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
  syncedLedger: 4_213_405,
  milestones: [
    { index: 0, title: "Public receipt prototype", amount: 40, yesWeight: 100, noWeight: 0, status: "released" },
    { index: 1, title: "Field verification launch", amount: 60, yesWeight: 0, noWeight: 0, status: "voting" },
  ],
};

describe("materialized state protection", () => {
  it("does not re-apply a contribution already included in the contract read", () => {
    const state = reduceActivity(
      { grants: [persisted], events: [] },
      event({ id: "old-contribution", kind: "ContributionMade", grantId: 1, amount: 100, ledger: 4_000_000 }),
    );
    expect(state.grants[0].raised).toBe(100);
    expect(state.events).toHaveLength(1);
  });

  it("does not re-apply a weighted vote already included in the contract read", () => {
    const state = reduceActivity(
      { grants: [persisted], events: [] },
      event({ id: "old-vote", kind: "MilestoneVoteCast", grantId: 1, milestone: 0, approve: true, amount: 100, ledger: 4_000_000 }),
    );
    expect(state.grants[0].milestones[0].yesWeight).toBe(100);
  });

  it("still applies an event confirmed after the contract read", () => {
    const state = reduceActivity(
      { grants: [persisted], events: [] },
      event({ id: "new-vote", kind: "MilestoneVoteCast", grantId: 1, milestone: 1, approve: true, amount: 25, ledger: 4_213_500 }),
    );
    expect(state.grants[0].milestones[1].yesWeight).toBe(25);
  });

  it("keeps an indexer snapshot free of replayed totals", () => {
    const materialized: GrantView = { ...persisted, syncedLedger: undefined };
    const state = applyActivitySnapshot(
      [materialized],
      [event({ id: "snapshot-contribution", kind: "ContributionMade", grantId: 1, amount: 100, total: 100, ledger: 4_000_000 })],
    );
    expect(state.grants[0].raised).toBe(100);
    expect(state.events).toHaveLength(1);
  });
});

describe("authoritative merge", () => {
  it("lets direct contract state win over stale indexer values", () => {
    const stale: GrantView = { ...persisted, raised: 40, status: "funding", currentMilestone: 0, syncedLedger: undefined };
    const merged = mergeAuthoritativeGrants([stale], [persisted]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ raised: 100, status: "active", currentMilestone: 1 });
  });

  it("deduplicates a grant discovered by both events and contract reads", () => {
    const fromEvent: GrantView = { ...persisted, raised: 0, milestones: [], syncedLedger: undefined };
    const merged = mergeAuthoritativeGrants([fromEvent, { ...persisted, id: 2 }], [persisted]);
    expect(merged.map((grant) => grant.id)).toEqual([2, 1]);
    expect(merged.find((grant) => grant.id === 1)?.raised).toBe(100);
  });

  it("keeps live events applied on top of an equally fresh baseline", () => {
    const withLiveVote: GrantView = {
      ...persisted,
      milestones: persisted.milestones.map((milestone) => (milestone.index === 1 ? { ...milestone, yesWeight: 25 } : milestone)),
    };
    const merged = mergeAuthoritativeGrants([withLiveVote], [persisted]);
    expect(merged[0].milestones[1].yesWeight).toBe(25);
  });

  it("adds a grant that only the contract knows about", () => {
    const merged = mergeAuthoritativeGrants([], [persisted]);
    expect(merged.map((grant) => grant.id)).toEqual([1]);
  });

  it("preserves operator copy already shown for the grant", () => {
    const described: GrantView = { ...persisted, description: "Operator written summary.", syncedLedger: undefined };
    const merged = mergeAuthoritativeGrants([described], [persisted]);
    expect(merged[0].description).toBe("Operator written summary.");
  });
});
