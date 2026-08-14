import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { CATEGORIES, type ActivityEvent, type ActivityKind } from "../../src/domain/grants.js";

const KINDS: Record<string, ActivityKind> = {
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

export type NativeEvent = {
  id: string;
  contractId: string;
  topics: unknown[];
  value: Record<string, unknown>;
  txHash: string;
  ledger: number;
  closedAt: string;
};

export type IndexedContractEvent = {
  schemaVersion: 1;
  id: string;
  contractId: string;
  topic: string;
  topics: unknown[];
  value: unknown;
  txHash: string;
  ledger: number;
  closedAt: string;
};

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function numeric(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function xlm(value: unknown) {
  return numeric(value) / 10_000_000;
}

function actor(value: unknown) {
  const text = String(value ?? "");
  return text.length > 13 ? `${text.slice(0, 6)}...${text.slice(-5)}` : text;
}

export function decodeNativeEvent(event: NativeEvent): ActivityEvent | null {
  const kind = KINDS[String(event.topics[0])];
  if (!kind) return null;
  const isSignal = kind === "VoteCast";
  const categoryIndex = isSignal ? numeric(event.topics[2]) : kind === "GrantCreated" ? numeric(event.topics[2]) : undefined;
  const amount = event.value.amount ?? event.value.goal ?? event.value.weight ?? event.value.available;
  const total = event.value.total ?? event.value.released;
  return {
    id: event.id,
    kind,
    contractId: event.contractId,
    grantId: isSignal ? undefined : numeric(event.topics[1]),
    actor: isSignal
      ? actor(event.topics[1])
      : kind === "ContributionMade" || kind === "RefundClaimed"
        ? actor(event.topics[2])
        : actor(event.value.creator ?? event.value.voter ?? event.value.contributor),
    category: categoryIndex === undefined ? undefined : CATEGORIES[categoryIndex] ?? "Payments",
    title: event.value.title ? String(event.value.title) : undefined,
    amount: isSignal ? numeric(amount) : xlm(amount),
    total: total === undefined ? undefined : xlm(total),
    approve: event.value.approve === undefined ? undefined : Boolean(event.value.approve),
    milestone: isSignal || event.topics[2] === undefined ? undefined : numeric(event.topics[2]),
    funded: event.value.funded === undefined ? undefined : Boolean(event.value.funded),
    txHash: event.txHash,
    ledger: event.ledger,
    closedAt: event.closedAt,
    deadline: event.value.deadline === undefined
      ? undefined
      : new Date(numeric(event.value.deadline) * 1_000).toISOString(),
  };
}

export function decodeRpcEvent(event: rpc.Api.EventResponse) {
  try {
    return decodeNativeEvent({
      id: event.id,
      contractId: event.contractId?.toString() ?? "",
      topics: event.topic.map((topic) => scValToNative(topic)),
      value: (scValToNative(event.value) ?? {}) as Record<string, unknown>,
      txHash: event.txHash,
      ledger: event.ledger,
      closedAt: event.ledgerClosedAt,
    });
  } catch {
    return null;
  }
}

export function decodeIndexedRpcEvent(event: rpc.Api.EventResponse): IndexedContractEvent | null {
  try {
    const topics = event.topic.map((topic) => scValToNative(topic));
    return {
      schemaVersion: 1,
      id: event.id,
      contractId: event.contractId?.toString() ?? "",
      topic: String(topics[0] ?? "unknown"),
      topics: jsonSafe(topics) as unknown[],
      value: jsonSafe(scValToNative(event.value)),
      txHash: event.txHash,
      ledger: event.ledger,
      closedAt: event.ledgerClosedAt,
    };
  } catch {
    return null;
  }
}
