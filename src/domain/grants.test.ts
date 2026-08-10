import { describe, expect, it } from "vitest";
import {
  DEMO_GRANTS,
  applyActivitySnapshot,
  reduceActivity,
  validateGrant,
  type ActivityEvent,
  type CreateGrantInput,
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

