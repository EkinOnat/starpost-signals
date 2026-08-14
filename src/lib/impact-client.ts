import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  IMPACT_ENABLED,
  IMPACT_ESCROW_CONTRACT_ID,
  IMPACT_REGISTRY_CONTRACT_ID,
  NATIVE_ASSET_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  READ_ONLY_SOURCE,
  RPC_URL,
} from "../config";
import {
  IMPACT_CATEGORIES,
  parseAtomicAmount,
  type ImpactMilestoneStatus,
  type ImpactProjectView,
  type ProjectDraftInput,
  type ProjectStatus,
} from "../domain/impact";
import { sc, submitContractCall, type TransactionUpdate } from "./transaction";
import { readContentAddressedJson, storeContentAddressedJson } from "./evidence-client";

const server = new rpc.Server(RPC_URL);

type MutationContext = {
  address: string;
  onUpdate: (update: TransactionUpdate) => void;
};

function requireImpactDeployment() {
  if (!IMPACT_ENABLED) throw new Error("IMPACT_NOT_DEPLOYED");
}

function map(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) =>
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol(key),
            val: value,
          }),
      ),
  );
}

function enumValue(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

function bytes32(hex: string): xdr.ScVal {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("INVALID_SHA256");
  return nativeToScVal(
    Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)),
  );
}

function addressVector(addresses: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(addresses.map((address) => new Address(address).toScVal()));
}

function enumName(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  return String(value);
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
  const normalized = enumName(value).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  const values: ProjectStatus[] = [
    "draft",
    "funding",
    "funded",
    "active",
    "completed",
    "failed",
    "cancelled",
    "disputed",
  ];
  return values.find((status) => status === normalized) ?? "draft";
}

function normalizeMilestoneStatus(value: unknown): ImpactMilestoneStatus {
  const normalized = enumName(value).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  const values: ImpactMilestoneStatus[] = [
    "pending",
    "evidence_submitted",
    "under_review",
    "verified",
    "voting",
    "disputed",
    "approved",
    "rejected",
    "released",
  ];
  return values.find((status) => status === normalized) ?? "pending";
}

function hexFromNative(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data: unknown }).data;
    if (data instanceof Uint8Array) return hexFromNative(data);
  }
  return "";
}

async function readContract(contractId: string, method: string, args: xdr.ScVal[] = []) {
  requireImpactDeployment();
  const account = await server.getAccount(READ_ONLY_SOURCE);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result) {
    throw new Error(
      rpc.Api.isSimulationError(simulation)
        ? simulation.error
        : `${method} returned no value`,
    );
  }
  return scValToNative(simulation.result.retval) as unknown;
}

export async function readImpactProjectCount(): Promise<number> {
  const value = await readContract(IMPACT_REGISTRY_CONTRACT_ID, "project_count");
  return Number(value);
}

export async function readImpactProject(id: number): Promise<ImpactProjectView> {
  const [projectValue, milestoneValue, vaultValue, configValue] = await Promise.all([
    readContract(IMPACT_REGISTRY_CONTRACT_ID, "get_project", [sc.u64(id)]),
    readContract(IMPACT_REGISTRY_CONTRACT_ID, "get_milestones", [sc.u64(id)]),
    readContract(IMPACT_ESCROW_CONTRACT_ID, "get_vault", [sc.u64(id)]).catch(() => null),
    readContract(IMPACT_REGISTRY_CONTRACT_ID, "get_config"),
  ]);
  const project = projectValue as Record<string, unknown>;
  const milestones = milestoneValue as Array<Record<string, unknown>>;
  const vault = vaultValue as Record<string, unknown> | null;
  const config = configValue as Record<string, unknown>;
  const pausedAt = config.pause_started_at === null || config.pause_started_at === undefined
    ? 0
    : Number(config.pause_started_at);
  const clockOffset = Number(config.total_paused_seconds ?? 0)
    + (pausedAt ? Math.max(0, Math.floor(Date.now() / 1_000) - pausedAt) : 0);
  const wallClock = (effectiveTimestamp: unknown) => {
    const timestamp = Number(effectiveTimestamp ?? 0);
    return timestamp > 0 ? timestamp + clockOffset : 0;
  };
  const category = IMPACT_CATEGORIES[Number(project.category)] ?? "Payments";
  const assetContract = String(project.asset ?? "");
  const metadata = await readContentAddressedJson<{ title?: string; description?: string }>(
    hexFromNative(project.metadata_sha256),
  ).catch(() => null);
  const milestoneMetadata = await Promise.all(milestones.map((milestone) =>
    readContentAddressedJson<{ title?: string; description?: string }>(
      hexFromNative(milestone.metadata_sha256),
    ).catch(() => null),
  ));
  const evidence = await Promise.all(milestones.map((milestone) => {
    const status = normalizeMilestoneStatus(milestone.status);
    if (status === "pending") return null;
    return readContract(IMPACT_REGISTRY_CONTRACT_ID, "get_evidence", [
      sc.u64(id),
      sc.u32(Number(milestone.index)),
      sc.u32(Number(milestone.attempt ?? 1)),
    ]).catch(() => null) as Promise<Record<string, unknown> | null>;
  }));
  return {
    id,
    category,
    metadataHash: hexFromNative(project.metadata_sha256),
    title: metadata?.title ?? `Project #${id}`,
    description: metadata?.description ?? "Content-addressed project metadata is not available from the configured evidence service.",
    creator: String(project.creator ?? ""),
    payout: String(project.payout ?? ""),
    assetContract,
    assetCode: assetContract === NATIVE_ASSET_CONTRACT_ID ? "XLM" : "SAC",
    assetDecimals: 7,
    goalAtomic: String(project.goal ?? "0"),
    depositedAtomic: String(vault?.deposited ?? "0"),
    releasedAtomic: String(vault?.released ?? "0"),
    refundable: Boolean(vault?.refundable),
    fundingDeadline: wallClock(project.funding_deadline),
    status: normalizeProjectStatus(project.status),
    currentMilestone: Number(project.current_milestone ?? 0),
    contributorCount: Number(project.contributor_count ?? 0),
    eligibleVotingPowerAtomic: String(project.eligible_voting_power ?? "0"),
    reviewers: (project.reviewers as unknown[] | undefined)?.map(String) ?? [],
    arbitrators: (project.arbitrators as unknown[] | undefined)?.map(String) ?? [],
    milestones: milestones.map((milestone, index) => ({
      index: Number(milestone.index),
      metadataHash: hexFromNative(milestone.metadata_sha256),
      title: milestoneMetadata[index]?.title ?? `Milestone ${index + 1}`,
      description: milestoneMetadata[index]?.description ?? "Proof criteria are unavailable from the configured metadata service.",
      evidenceContentHash: hexFromNative(evidence[index]?.content_sha256),
      evidenceMetadataHash: hexFromNative(evidence[index]?.metadata_sha256),
      amountAtomic: String(milestone.amount ?? "0"),
      deliveryWindow: Number(milestone.delivery_window ?? 0),
      status: normalizeMilestoneStatus(milestone.status),
      attempt: Number(milestone.attempt ?? 1),
      evidenceDueAt: wallClock(milestone.evidence_due_at),
      reviewDeadline: wallClock(milestone.review_deadline),
      votingDeadline: wallClock(milestone.voting_deadline),
      disputeDeadline: wallClock(milestone.dispute_deadline),
      reworkDeadline: wallClock(milestone.rework_deadline),
      verifyCount: Number(milestone.verify_count ?? 0),
      rejectCount: Number(milestone.reject_count ?? 0),
      approveWeightAtomic: String(milestone.approve_weight ?? "0"),
      disputeWeightAtomic: String(milestone.dispute_weight ?? "0"),
    })),
  };
}

export async function readImpactProjects(limit = 100): Promise<ImpactProjectView[]> {
  const count = await readImpactProjectCount();
  const ids = Array.from({ length: Math.min(count, limit) }, (_, index) => count - index);
  const projects: ImpactProjectView[] = [];
  for (let offset = 0; offset < ids.length; offset += 5) {
    const batch = await Promise.allSettled(ids.slice(offset, offset + 5).map(readImpactProject));
    for (const result of batch) {
      if (result.status === "fulfilled") projects.push(result.value);
    }
  }
  return projects;
}

export async function createImpactProject(
  input: ProjectDraftInput,
  context: MutationContext,
): Promise<string> {
  requireImpactDeployment();
  const projectMetadata = {
    schema: "starpost.project/1",
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category,
  };
  const projectMetadataHash = await storeContentAddressedJson(projectMetadata);
  const milestoneMetadata = await Promise.all(
    input.milestones.map((milestone, index) =>
      storeContentAddressedJson({
        schema: "starpost.milestone/1",
        index,
        title: milestone.title.trim(),
        description: milestone.description.trim(),
      }),
    ),
  );
  const projectInput = map({
    asset: sc.address(NATIVE_ASSET_CONTRACT_ID),
    category: sc.u32(IMPACT_CATEGORIES.indexOf(input.category)),
    funding_deadline: sc.u64(Math.floor(new Date(input.fundingDeadline).getTime() / 1_000)),
    goal: sc.i128(parseAtomicAmount(input.goal, 7)),
    metadata_sha256: bytes32(projectMetadataHash),
    payout: sc.address(input.payout),
  });
  const milestones = xdr.ScVal.scvVec(
    input.milestones.map((milestone, index) =>
      map({
        amount: sc.i128(parseAtomicAmount(milestone.amount, 7)),
        delivery_window: sc.u64(BigInt(milestone.deliveryDays) * 86_400n),
        metadata_sha256: bytes32(milestoneMetadata[index]),
      }),
    ),
  );
  const reviews = map({
    arbitrators: addressVector(input.arbitrators),
    reviewers: addressVector(input.reviewers),
  });
  return submitContractCall({
    ...context,
    contractId: IMPACT_REGISTRY_CONTRACT_ID,
    method: "create_project",
    label: "Create proof-based project",
    args: [sc.address(context.address), projectInput, milestones, reviews],
  });
}

function registryMutation(
  method: string,
  label: string,
  args: xdr.ScVal[],
  context: MutationContext,
  spendXlm?: number,
) {
  requireImpactDeployment();
  return submitContractCall({
    ...context,
    contractId: IMPACT_REGISTRY_CONTRACT_ID,
    method,
    label,
    args,
    spendXlm,
  });
}

export const acceptImpactRole = (
  projectId: number,
  role: "reviewer" | "arbitrator",
  context: MutationContext,
) =>
  registryMutation(
    role === "reviewer" ? "accept_reviewer" : "accept_arbitrator",
    `Accept ${role} assignment`,
    [sc.address(context.address), sc.u64(projectId)],
    context,
  );

export const openImpactFunding = (projectId: number, context: MutationContext) =>
  registryMutation(
    "open_funding",
    "Open project funding",
    [sc.address(context.address), sc.u64(projectId)],
    context,
  );

export const contributeImpact = (
  projectId: number,
  amount: string,
  context: MutationContext,
) =>
  registryMutation(
    "contribute",
    "Contribute Testnet XLM",
    [sc.address(context.address), sc.u64(projectId), sc.i128(parseAtomicAmount(amount, 7))],
    context,
    Number(amount),
  );

export const activateImpactProject = (projectId: number, context: MutationContext) =>
  registryMutation("activate_project", "Activate project", [sc.u64(projectId)], context);

export const openImpactReview = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) =>
  registryMutation(
    "open_review",
    "Open evidence review",
    [sc.u64(projectId), sc.u32(milestone)],
    context,
  );

export const attestImpact = (
  projectId: number,
  milestone: number,
  attempt: number,
  evidenceHash: string,
  decision: "Verify" | "Reject",
  context: MutationContext,
) =>
  registryMutation(
    "attest",
    `${decision} milestone evidence`,
    [
      sc.address(context.address),
      sc.u64(projectId),
      sc.u32(milestone),
      sc.u32(attempt),
      bytes32(evidenceHash),
      enumValue(decision),
    ],
    context,
  );

export const openImpactVoting = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) =>
  registryMutation(
    "open_voting",
    "Open contributor voting",
    [sc.u64(projectId), sc.u32(milestone)],
    context,
  );

export const voteImpact = (
  projectId: number,
  milestone: number,
  attempt: number,
  evidenceHash: string,
  decision: "Approve" | "Dispute",
  context: MutationContext,
) =>
  registryMutation(
    "vote",
    decision === "Approve" ? "Approve milestone" : "Dispute milestone",
    [
      sc.address(context.address),
      sc.u64(projectId),
      sc.u32(milestone),
      sc.u32(attempt),
      bytes32(evidenceHash),
      enumValue(decision),
    ],
    context,
  );

export const finalizeImpactVote = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) =>
  registryMutation(
    "finalize_vote",
    "Finalize contributor vote",
    [sc.u64(projectId), sc.u32(milestone)],
    context,
  );

export const arbitrateImpact = (
  projectId: number,
  milestone: number,
  attempt: number,
  decision: "ApproveRelease" | "RejectMilestone" | "RequireRework",
  context: MutationContext,
) =>
  registryMutation(
    "arbitrate",
    "Record arbitration decision",
    [
      sc.address(context.address),
      sc.u64(projectId),
      sc.u32(milestone),
      sc.u32(attempt),
      enumValue(decision),
    ],
    context,
  );

export const finalizeImpactDispute = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) =>
  registryMutation(
    "finalize_dispute",
    "Finalize dispute",
    [sc.u64(projectId), sc.u32(milestone)],
    context,
  );

export const releaseImpactMilestone = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) =>
  registryMutation(
    "release_milestone",
    "Release exact milestone payout",
    [sc.u64(projectId), sc.u32(milestone)],
    context,
  );

export const applyImpactTimeout = (projectId: number, context: MutationContext) =>
  registryMutation("apply_timeout", "Apply project deadline", [sc.u64(projectId)], context);

export const finalizeImpactFunding = (projectId: number, context: MutationContext) =>
  registryMutation("finalize_funding", "Finalize project funding", [sc.u64(projectId)], context);

export const finalizeImpactReview = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) => registryMutation("finalize_review", "Finalize evidence review", [sc.u64(projectId), sc.u32(milestone)], context);

export const startImpactRework = (
  projectId: number,
  milestone: number,
  context: MutationContext,
) => registryMutation(
  "start_rework",
  "Start evidence rework",
  [sc.address(context.address), sc.u64(projectId), sc.u32(milestone)],
  context,
);

export const cancelImpactProject = (projectId: number, context: MutationContext) =>
  registryMutation(
    "cancel_project",
    "Cancel project",
    [sc.address(context.address), sc.u64(projectId)],
    context,
  );

export const claimImpactRefund = (projectId: number, context: MutationContext) => {
  requireImpactDeployment();
  return submitContractCall({
    ...context,
    contractId: IMPACT_ESCROW_CONTRACT_ID,
    method: "claim_refund",
    label: "Claim project refund",
    args: [sc.u64(projectId), sc.address(context.address)],
  });
};

export const submitImpactEvidence = (
  projectId: number,
  milestone: number,
  attempt: number,
  contentHash: string,
  metadataHashHex: string,
  context: MutationContext,
) =>
  registryMutation(
    "submit_evidence",
    "Anchor evidence hash",
    [
      sc.address(context.address),
      sc.u64(projectId),
      sc.u32(milestone),
      map({
        attempt: sc.u32(attempt),
        content_sha256: bytes32(contentHash),
        metadata_sha256: bytes32(metadataHashHex),
      }),
    ],
    context,
  );
