export const CATEGORIES = ["Payments", "Identity", "Climate", "Gaming"] as const;

export type GrantCategory = (typeof CATEGORIES)[number];
export type GrantStatus =
  | "funding"
  | "active"
  | "failed"
  | "cancelled"
  | "completed";

export type MilestoneStatus = "pending" | "voting" | "released";

export type MilestoneView = {
  index: number;
  title: string;
  amount: number;
  yesWeight: number;
  noWeight: number;
  status: MilestoneStatus;
};

export type GrantView = {
  id: number;
  title: string;
  description: string;
  category: GrantCategory;
  creator: string;
  asset: string;
  goal: number;
  raised: number;
  deadline: string;
  approvalBps: number;
  quorumBps: number;
  status: GrantStatus;
  currentMilestone: number;
  milestones: MilestoneView[];
  demo?: boolean;
};

export type ActivityKind =
  | "VoteCast"
  | "GrantCreated"
  | "VaultOpened"
  | "ContributionMade"
  | "FundingFinalized"
  | "MilestoneVoteCast"
  | "MilestoneApproved"
  | "FundsReleased"
  | "RefundEnabled"
  | "RefundClaimed"
  | "GrantCancelled"
  | "GrantCompleted";

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  contractId: string;
  grantId?: number;
  actor?: string;
  category?: GrantCategory;
  title?: string;
  amount?: number;
  total?: number;
  approve?: boolean;
  milestone?: number;
  funded?: boolean;
  txHash: string;
  ledger: number;
  closedAt: string;
  deadline?: string;
};

export type GrantState = {
  grants: GrantView[];
  events: ActivityEvent[];
};

export type SyncStatus = "connecting" | "live" | "retrying" | "offline";

export const DEMO_GRANTS: GrantView[] = [
  {
    id: 1,
    title: "Borderless merchant checkout",
    description:
      "A reference checkout that lets small merchants settle Testnet payments in seconds with a transparent fee breakdown.",
    category: "Payments",
    creator: "GCDR...8N4K",
    asset: "XLM",
    goal: 2400,
    raised: 1840,
    deadline: "2026-09-18T18:00:00.000Z",
    approvalBps: 6000,
    quorumBps: 5000,
    status: "funding",
    currentMilestone: 0,
    demo: true,
    milestones: [
      { index: 0, title: "Payment flow prototype", amount: 900, yesWeight: 0, noWeight: 0, status: "voting" },
      { index: 1, title: "Merchant pilot", amount: 1500, yesWeight: 0, noWeight: 0, status: "pending" },
    ],
  },
  {
    id: 2,
    title: "Open climate receipts",
    description:
      "Public proof-of-impact receipts for community solar projects, anchored to Stellar and readable without a wallet.",
    category: "Climate",
    creator: "GB7Q...2PLM",
    asset: "XLM",
    goal: 5000,
    raised: 5000,
    deadline: "2026-08-28T16:00:00.000Z",
    approvalBps: 6600,
    quorumBps: 5000,
    status: "active",
    currentMilestone: 1,
    demo: true,
    milestones: [
      { index: 0, title: "Data schema", amount: 1500, yesWeight: 4200, noWeight: 200, status: "released" },
      { index: 1, title: "Field verification pilot", amount: 2000, yesWeight: 3100, noWeight: 400, status: "voting" },
      { index: 2, title: "Public explorer", amount: 1500, yesWeight: 0, noWeight: 0, status: "pending" },
    ],
  },
  {
    id: 3,
    title: "Portable player reputation",
    description:
      "A privacy-aware identity layer that lets players carry achievements between independent game worlds.",
    category: "Gaming",
    creator: "GC4M...T91X",
    asset: "XLM",
    goal: 3200,
    raised: 3200,
    deadline: "2026-07-30T12:00:00.000Z",
    approvalBps: 6000,
    quorumBps: 4500,
    status: "completed",
    currentMilestone: 1,
    demo: true,
    milestones: [
      { index: 0, title: "Identity primitives", amount: 1400, yesWeight: 2900, noWeight: 100, status: "released" },
      { index: 1, title: "Two-game integration", amount: 1800, yesWeight: 3000, noWeight: 80, status: "released" },
    ],
  },
];

function sortEvents(events: ActivityEvent[]) {
  return [...events]
    .filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index)
    .sort((a, b) => b.ledger - a.ledger)
    .slice(0, 2_000);
}

export function reduceActivity(state: GrantState, event: ActivityEvent): GrantState {
  if (state.events.some((existing) => existing.id === event.id)) return state;
  let grants = state.grants;
  const grantIndex = event.grantId === undefined
    ? -1
    : grants.findIndex((grant) => grant.id === event.grantId);

  if (event.kind === "GrantCreated" && event.grantId !== undefined && grantIndex === -1) {
    grants = [
      {
        id: event.grantId,
        title: event.title ?? `Grant #${event.grantId}`,
        description: "Community grant created from a Starpost signal.",
        category: event.category ?? "Payments",
        creator: event.actor ?? "Unknown creator",
        asset: "XLM",
        goal: event.amount ?? 0,
        raised: 0,
        deadline: event.deadline ?? event.closedAt,
        approvalBps: 6000,
        quorumBps: 5000,
        status: "funding",
        currentMilestone: 0,
        milestones: [],
      },
      ...grants,
    ];
  } else if (grantIndex >= 0) {
    grants = grants.map((grant, index) => {
      if (index !== grantIndex) return grant;
      if (event.kind === "ContributionMade") {
        return { ...grant, raised: event.total ?? grant.raised + (event.amount ?? 0) };
      }
      if (event.kind === "FundingFinalized") {
        return { ...grant, status: event.funded ? "active" : "failed" };
      }
      if (event.kind === "GrantCancelled") return { ...grant, status: "cancelled" };
      if (event.kind === "GrantCompleted") return { ...grant, status: "completed" };
      if (event.kind === "MilestoneVoteCast" && event.milestone !== undefined) {
        return {
          ...grant,
          milestones: grant.milestones.map((milestone) =>
            milestone.index !== event.milestone
              ? milestone
              : {
                  ...milestone,
                  yesWeight: milestone.yesWeight + (event.approve ? event.amount ?? 0 : 0),
                  noWeight: milestone.noWeight + (!event.approve ? event.amount ?? 0 : 0),
                },
          ),
        };
      }
      if (event.kind === "MilestoneApproved" && event.milestone !== undefined) {
        const next = event.milestone + 1;
        const finished = next >= grant.milestones.length && grant.milestones.length > 0;
        return {
          ...grant,
          status: finished ? "completed" : grant.status,
          currentMilestone: finished ? grant.currentMilestone : next,
          milestones: grant.milestones.map((milestone) => ({
            ...milestone,
            status:
              milestone.index === event.milestone
                ? "released"
                : milestone.index === next
                  ? "voting"
                  : milestone.status,
          })),
        };
      }
      return grant;
    });
  }

  return { grants, events: sortEvents([event, ...state.events]) };
}

export function applyActivitySnapshot(
  grants: GrantView[],
  events: ActivityEvent[],
): GrantState {
  // The indexer snapshot is already materialized from these events. Replaying
  // them here would double-count weighted votes and other additive fields.
  return { grants: structuredClone(grants), events: sortEvents(events) };
}

export type CreateGrantInput = {
  category: GrantCategory;
  title: string;
  description: string;
  goal: number;
  deadline: string;
  milestones: Array<{ title: string; amount: number }>;
  approvalBps: number;
  quorumBps: number;
};

export function validateGrant(input: CreateGrantInput): string[] {
  const errors: string[] = [];
  if (input.title.trim().length < 4) errors.push("Add a title with at least four characters.");
  if (input.description.trim().length < 20) errors.push("Explain the project in at least 20 characters.");
  if (!Number.isFinite(input.goal) || input.goal <= 0) errors.push("Goal must be greater than 0 XLM.");
  if (!input.deadline || new Date(input.deadline).getTime() <= Date.now()) errors.push("Choose a future funding deadline.");
  if (input.milestones.length < 2 || input.milestones.length > 5) errors.push("Use between two and five milestones.");
  if (input.milestones.some((milestone) => !milestone.title.trim() || milestone.amount <= 0)) {
    errors.push("Every milestone needs a title and positive amount.");
  }
  const total = input.milestones.reduce((sum, milestone) => sum + (Number(milestone.amount) || 0), 0);
  if (Math.abs(total - input.goal) > 0.0000001) errors.push("Milestone amounts must equal the funding goal.");
  if (input.approvalBps < 5000 || input.approvalBps > 10000) errors.push("Approval must be between 50% and 100%.");
  if (input.quorumBps < 1000 || input.quorumBps > 10000) errors.push("Quorum must be between 10% and 100%.");
  return errors;
}
