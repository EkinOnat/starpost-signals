import { StrKey } from "@stellar/stellar-sdk";

export const IMPACT_CATEGORIES = ["Payments", "Identity", "Climate", "Gaming"] as const;

export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];
export type ProjectStatus =
  | "draft"
  | "funding"
  | "funded"
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "disputed";

export type ImpactMilestoneStatus =
  | "pending"
  | "evidence_submitted"
  | "under_review"
  | "verified"
  | "voting"
  | "disputed"
  | "approved"
  | "rejected"
  | "released";

export type EvidenceStage =
  | "idle"
  | "validating"
  | "hashing"
  | "uploading"
  | "stored"
  | "anchoring_hash"
  | "confirmed"
  | "failed";

export type ImpactMilestoneView = {
  index: number;
  metadataHash: string;
  title: string;
  description: string;
  evidenceContentHash: string;
  evidenceMetadataHash: string;
  amountAtomic: string;
  deliveryWindow: number;
  status: ImpactMilestoneStatus;
  attempt: number;
  evidenceDueAt: number;
  reviewDeadline: number;
  votingDeadline: number;
  disputeDeadline: number;
  reworkDeadline: number;
  verifyCount: number;
  rejectCount: number;
  approveWeightAtomic: string;
  disputeWeightAtomic: string;
};

export type ImpactProjectView = {
  id: number;
  category: ImpactCategory;
  metadataHash: string;
  title: string;
  description: string;
  creator: string;
  payout: string;
  assetContract: string;
  assetCode: string;
  assetDecimals: number;
  goalAtomic: string;
  depositedAtomic: string;
  releasedAtomic: string;
  refundable: boolean;
  fundingDeadline: number;
  status: ProjectStatus;
  currentMilestone: number;
  contributorCount: number;
  eligibleVotingPowerAtomic: string;
  reviewers: string[];
  arbitrators: string[];
  milestones: ImpactMilestoneView[];
};

export type ProjectDraftInput = {
  category: ImpactCategory;
  title: string;
  description: string;
  payout: string;
  goal: string;
  fundingDeadline: string;
  reviewers: string[];
  arbitrators: string[];
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
    deliveryDays: number;
  }>;
};

export function parseAtomicAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("INVALID_AMOUNT");
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error("TOO_MANY_DECIMALS");
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatAtomicAmount(value: string | bigint, decimals: number): string {
  const atomic = typeof value === "bigint" ? value : BigInt(value);
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function metadataHash(value: unknown): Promise<string> {
  return sha256Hex(stableJson(value));
}

export function validateProjectDraft(input: ProjectDraftInput): string[] {
  const errors: string[] = [];
  if (input.title.trim().length < 4) errors.push("Add a project title with at least four characters.");
  if (input.description.trim().length < 20) errors.push("Describe the intended impact in at least 20 characters.");
  if (!StrKey.isValidEd25519PublicKey(input.payout.trim())) errors.push("Add a valid Stellar payout account (G address).");
  if (input.reviewers.length !== 3) errors.push("Assign exactly three independent reviewers.");
  if (input.arbitrators.length !== 3) errors.push("Assign exactly three independent arbitrators.");
  const roles = [...input.reviewers, ...input.arbitrators].map((address) => address.trim());
  if (roles.some((address) => !StrKey.isValidEd25519PublicKey(address))) errors.push("Every reviewer and arbitrator must be a valid Stellar G address.");
  if (new Set(roles).size !== roles.length) errors.push("Reviewers and arbitrators must all be unique.");
  if (roles.includes(input.payout.trim())) errors.push("The payout address cannot review or arbitrate its own project.");
  if (input.milestones.length < 2 || input.milestones.length > 5) errors.push("Use between two and five milestones.");
  try {
    const goal = parseAtomicAmount(input.goal, 7);
    const total = input.milestones.reduce(
      (sum, milestone) => sum + parseAtomicAmount(milestone.amount, 7),
      0n,
    );
    if (goal <= 0n) errors.push("Goal must be greater than zero.");
    if (goal !== total) errors.push("Milestone amounts must equal the project goal exactly.");
  } catch {
    errors.push("Use valid XLM amounts with no more than seven decimal places.");
  }
  if (input.milestones.some((milestone) => milestone.title.trim().length < 3 || milestone.deliveryDays < 1)) {
    errors.push("Every milestone needs a title and a delivery window of at least one day.");
  }
  if (!input.fundingDeadline || new Date(input.fundingDeadline).getTime() <= Date.now()) {
    errors.push("Choose a future funding deadline.");
  }
  return errors;
}

export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}
