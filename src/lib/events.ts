import { rpc, scValToNative } from "@stellar/stellar-sdk";
import {
  CONTRACT_ID,
  ESCROW_CONTRACT_ID,
  REGISTRY_CONTRACT_ID,
  RPC_URL,
} from "../config";
import { CATEGORIES, type ActivityEvent, type ActivityKind } from "../domain/grants";

const server = new rpc.Server(RPC_URL);

const EVENT_KINDS: Record<string, ActivityKind> = {
  vote_cast: "VoteCast",
  grant_created: "GrantCreated",
  vault_opened: "VaultOpened",
  contribution_made: "ContributionMade",
  funding_finalized: "FundingFinalized",
  milestone_vote_cast: "MilestoneVoteCast",
  milestone_approved: "MilestoneApproved",
  funds_released: "FundsReleased",
  refund_enabled: "RefundEnabled",
  refund_claimed: "RefundClaimed",
  grant_cancelled: "GrantCancelled",
};

function asNumber(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function xlm(value: unknown) {
  return asNumber(value) / 10_000_000;
}

function asAddress(value: unknown) {
  const text = String(value ?? "");
  return text.length > 13 ? `${text.slice(0, 6)}...${text.slice(-5)}` : text;
}

export function decodeActivityEvent(event: rpc.Api.EventResponse): ActivityEvent | null {
  const topics = event.topic.map((topic) => scValToNative(topic));
  const kind = EVENT_KINDS[String(topics[0])];
  if (!kind) return null;
  const value = (scValToNative(event.value) ?? {}) as Record<string, unknown>;
  const grantId = kind === "VoteCast" ? undefined : asNumber(topics[1]);
  const option = kind === "VoteCast" ? asNumber(topics[2]) : undefined;
  const categoryIndex = kind === "GrantCreated" ? asNumber(topics[2]) : option;
  const amount = value.amount ?? value.goal ?? value.weight ?? value.available;
  const total = value.total ?? value.released;
  const actor =
    kind === "VoteCast"
      ? asAddress(topics[1])
      : kind === "ContributionMade" || kind === "RefundClaimed"
        ? asAddress(topics[2])
        : asAddress(value.creator ?? value.voter ?? value.contributor);
  return {
    id: event.id,
    kind,
    provenance: "live",
    contractId: event.contractId?.toString() ?? "",
    grantId,
    actor,
    category:
      categoryIndex === undefined ? undefined : CATEGORIES[categoryIndex] ?? "Payments",
    title: value.title ? String(value.title) : undefined,
    amount: kind === "VoteCast" ? asNumber(amount) : xlm(amount),
    total: total === undefined ? undefined : xlm(total),
    approve: value.approve === undefined ? undefined : Boolean(value.approve),
    milestone:
      topics[2] === undefined || kind === "VoteCast" ? undefined : asNumber(topics[2]),
    funded: value.funded === undefined ? undefined : Boolean(value.funded),
    txHash: event.txHash,
    ledger: event.ledger,
    closedAt: event.ledgerClosedAt,
    deadline: value.deadline === undefined
      ? undefined
      : new Date(asNumber(value.deadline) * 1_000).toISOString(),
  };
}

export async function fetchActivityEvents(cursor?: string) {
  const contractIds = [CONTRACT_ID, REGISTRY_CONTRACT_ID, ESCROW_CONTRACT_ID].filter(Boolean);
  const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds }];
  const response = cursor
    ? await server.getEvents({ filters, cursor, limit: 100 })
    : await server.getLatestLedger().then((latest) =>
        server.getEvents({
          filters,
          startLedger: Math.max(1, latest.sequence - 2_000),
          limit: 100,
        }),
      );
  return {
    cursor: response.cursor,
    events: response.events
      .map(decodeActivityEvent)
      .filter((event): event is ActivityEvent => event !== null),
  };
}
