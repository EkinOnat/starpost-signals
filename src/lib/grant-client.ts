import {
  ESCROW_CONTRACT_ID,
  GRANTS_ENABLED,
  GRANT_READ_TIMEOUT_MS,
  NATIVE_ASSET_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  READ_ONLY_SOURCE,
  REGISTRY_CONTRACT_ID,
  RPC_URL,
} from "../config";
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { CATEGORIES, type CreateGrantInput, type GrantStatus, type GrantView, type MilestoneStatus } from "../domain/grants";
import { sc, submitContractCall, type TransactionUpdate } from "./transaction";

const STROOPS_PER_XLM = 10_000_000;
const readServer = new rpc.Server(RPC_URL);

// RegistryError::GrantNotFound. A contract error is a definitive "this id does
// not exist"; any other failure is a transport problem and must not be read as
// an empty registry.
const REGISTRY_GRANT_NOT_FOUND = 4;
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;
// Instance-storage key of the Registry's grant-id allocator (DataKey::NextGrantId).
const NEXT_GRANT_ID_KEY = "NextGrantId";
const READ_ACCOUNT_TTL_MS = 60_000;

export class ContractReadError extends Error {
  constructor(
    readonly contractId: string,
    readonly method: string,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ContractReadError";
  }
}

export function isMissingGrantError(error: unknown) {
  return (
    error instanceof ContractReadError &&
    error.contractId === REGISTRY_CONTRACT_ID &&
    error.code === REGISTRY_GRANT_NOT_FOUND
  );
}

async function withTimeout<T>(work: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${GRANT_READ_TIMEOUT_MS}ms`)),
          GRANT_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

let cachedReadAccount: { id: string; sequence: string; fetchedAt: number } | null = null;

// Simulation ignores the sequence number, so one cached account serves every
// read and keeps bounded discovery to a single RPC round trip per grant id.
async function readSourceAccount() {
  if (!cachedReadAccount || Date.now() - cachedReadAccount.fetchedAt > READ_ACCOUNT_TTL_MS) {
    const account = await withTimeout(readServer.getAccount(READ_ONLY_SOURCE), "read account");
    cachedReadAccount = {
      id: account.accountId(),
      sequence: account.sequenceNumber(),
      fetchedAt: Date.now(),
    };
  }
  return new Account(cachedReadAccount.id, cachedReadAccount.sequence);
}

function requireDeployment() {
  if (!GRANTS_ENABLED) throw new Error("GRANTS_NOT_DEPLOYED");
}

function stroops(xlm: number) {
  return BigInt(Math.round(xlm * STROOPS_PER_XLM));
}

function milestoneSchedule(input: CreateGrantInput) {
  return xdr.ScVal.scvVec(
    input.milestones.map((milestone) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("amount"),
          val: nativeToScVal(stroops(milestone.amount), { type: "i128" }),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("title"),
          val: nativeToScVal(milestone.title, { type: "string" }),
        }),
      ]),
    ),
  );
}

type MutationContext = {
  address: string;
  onUpdate: (update: TransactionUpdate) => void;
};

export async function createGrant(
  input: CreateGrantInput,
  context: MutationContext,
) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: REGISTRY_CONTRACT_ID,
    method: "create_grant",
    label: "Create grant",
    args: [
      sc.address(context.address),
      sc.u32(Math.max(0, ["Payments", "Identity", "Climate", "Gaming"].indexOf(input.category))),
      sc.string(input.title),
      sc.address(NATIVE_ASSET_CONTRACT_ID),
      sc.i128(stroops(input.goal)),
      sc.u64(Math.floor(new Date(input.deadline).getTime() / 1_000)),
      milestoneSchedule(input),
      sc.u32(input.approvalBps),
      sc.u32(input.quorumBps),
    ],
  });
}

export async function contributeToGrant(
  grantId: number,
  amountXlm: number,
  context: MutationContext,
) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: ESCROW_CONTRACT_ID,
    method: "contribute",
    label: "Contribute XLM",
    spendXlm: amountXlm,
    args: [sc.u64(grantId), sc.address(context.address), sc.i128(stroops(amountXlm))],
  });
}

export async function finalizeFunding(grantId: number, context: MutationContext) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: REGISTRY_CONTRACT_ID,
    method: "finalize_funding",
    label: "Finalize funding",
    args: [sc.u64(grantId)],
  });
}

export async function voteMilestone(
  grantId: number,
  approve: boolean,
  context: MutationContext,
) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: REGISTRY_CONTRACT_ID,
    method: "vote_milestone",
    label: approve ? "Approve milestone" : "Reject milestone",
    args: [sc.u64(grantId), sc.address(context.address), sc.bool(approve)],
  });
}

export async function finalizeMilestone(grantId: number, context: MutationContext) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: REGISTRY_CONTRACT_ID,
    method: "finalize_milestone",
    label: "Release milestone",
    args: [sc.u64(grantId)],
  });
}

export async function cancelGrant(grantId: number, context: MutationContext) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: REGISTRY_CONTRACT_ID,
    method: "cancel_grant",
    label: "Cancel grant",
    args: [sc.u64(grantId)],
  });
}

export async function claimRefund(grantId: number, context: MutationContext) {
  requireDeployment();
  return submitContractCall({
    ...context,
    contractId: ESCROW_CONTRACT_ID,
    method: "claim_refund",
    label: "Claim refund",
    args: [sc.u64(grantId), sc.address(context.address)],
  });
}

async function readContract(contractId: string, method: string, args: xdr.ScVal[]) {
  const account = await readSourceAccount();
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const simulation = await withTimeout(
    readServer.simulateTransaction(transaction),
    `${method} simulation`,
  );
  if (rpc.Api.isSimulationError(simulation)) {
    const code = CONTRACT_ERROR_PATTERN.exec(simulation.error)?.[1];
    throw new ContractReadError(
      contractId,
      method,
      code === undefined ? null : Number(code),
      simulation.error,
    );
  }
  if (!simulation.result) {
    throw new ContractReadError(contractId, method, null, `${method} returned no value`);
  }
  return scValToNative(simulation.result.retval) as unknown;
}

/**
 * Reads the Registry's grant-id allocator straight from contract instance
 * storage. The deployed Registry exposes no count or next-id getter, so this
 * ledger entry is the only authoritative enumeration bound. Returns null when
 * the allocator key is absent, which sends discovery to its bounded fallback.
 */
export async function readRegistryNextGrantId(): Promise<number | null> {
  requireDeployment();
  const entry = await withTimeout(
    readServer.getContractData(
      REGISTRY_CONTRACT_ID,
      xdr.ScVal.scvLedgerKeyContractInstance(),
      rpc.Durability.Persistent,
    ),
    "registry instance read",
  );
  const storage = entry.val.contractData().val().instance().storage() ?? [];
  for (const item of storage) {
    const key = scValToNative(item.key()) as unknown;
    const name = Array.isArray(key) ? key[0] : key;
    if (String(name) !== NEXT_GRANT_ID_KEY) continue;
    const value = Number(scValToNative(item.val()) as bigint | number);
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

/** Single-call existence probe used only by the bounded fallback scan. */
export async function grantExists(id: number): Promise<boolean> {
  requireDeployment();
  try {
    await readContract(REGISTRY_CONTRACT_ID, "get_grant", [sc.u64(id)]);
    return true;
  } catch (error) {
    if (isMissingGrantError(error)) return false;
    throw error;
  }
}

export async function readLatestLedger(): Promise<number> {
  const latest = await withTimeout(readServer.getLatestLedger(), "latest ledger");
  return latest.sequence;
}

function contractStatus(value: unknown): GrantStatus {
  const normalized = String(value).toLowerCase();
  return (["funding", "active", "failed", "cancelled", "completed"] as GrantStatus[]).find((status) => status === normalized) ?? "funding";
}

function milestoneStatus(value: unknown): MilestoneStatus {
  const normalized = String(value).toLowerCase();
  return (["pending", "voting", "released"] as MilestoneStatus[]).find((status) => status === normalized) ?? "pending";
}

export async function readGrantView(id: number, current?: GrantView): Promise<GrantView> {
  requireDeployment();
  // Settled rather than raced: a missing grant makes the escrow read fail too,
  // and only the Registry's GrantNotFound distinguishes "no such id" from an
  // RPC outage. Every leg must succeed — a partial read would show a real
  // grant with a fabricated 0 raised.
  const [grantResult, milestoneResult, totalResult] = await Promise.allSettled([
    readContract(REGISTRY_CONTRACT_ID, "get_grant", [sc.u64(id)]),
    readContract(REGISTRY_CONTRACT_ID, "get_milestones", [sc.u64(id)]),
    readContract(ESCROW_CONTRACT_ID, "total", [sc.u64(id)]),
  ]);
  if (grantResult.status === "rejected") throw grantResult.reason;
  if (milestoneResult.status === "rejected") throw milestoneResult.reason;
  if (totalResult.status === "rejected") throw totalResult.reason;
  const [grantValue, milestoneValue, totalValue] = [
    grantResult.value,
    milestoneResult.value,
    totalResult.value,
  ];
  const grant = grantValue as Record<string, unknown>;
  const milestones = milestoneValue as Array<Record<string, unknown>>;
  const category = CATEGORIES[Number(grant.category)] ?? "Payments";
  return {
    id,
    title: String(grant.title ?? current?.title ?? `Grant #${id}`),
    description: current?.description ?? `A ${category} grant created from a verified Starpost signal.`,
    category,
    creator: String(grant.creator ?? current?.creator ?? "Unknown creator"),
    asset: String(grant.asset) === NATIVE_ASSET_CONTRACT_ID ? "XLM" : String(grant.asset ?? "Asset"),
    goal: Number(grant.goal) / STROOPS_PER_XLM,
    raised: Number(totalValue) / STROOPS_PER_XLM,
    deadline: new Date(Number(grant.deadline) * 1_000).toISOString(),
    approvalBps: Number(grant.approval_bps),
    quorumBps: Number(grant.quorum_bps),
    status: contractStatus(grant.status),
    currentMilestone: Number(grant.current_milestone),
    milestones: milestones.map((milestone) => ({
      index: Number(milestone.index),
      title: String(milestone.title),
      amount: Number(milestone.amount) / STROOPS_PER_XLM,
      yesWeight: Number(milestone.yes_weight) / STROOPS_PER_XLM,
      noWeight: Number(milestone.no_weight) / STROOPS_PER_XLM,
      status: milestoneStatus(milestone.status),
    })),
  };
}
