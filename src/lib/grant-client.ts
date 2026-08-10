import {
  ESCROW_CONTRACT_ID,
  GRANTS_ENABLED,
  NATIVE_ASSET_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  READ_ONLY_SOURCE,
  REGISTRY_CONTRACT_ID,
  RPC_URL,
} from "../config";
import {
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
  const account = await readServer.getAccount(READ_ONLY_SOURCE);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const simulation = await readServer.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result) {
    throw new Error(rpc.Api.isSimulationError(simulation) ? simulation.error : `${method} returned no value`);
  }
  return scValToNative(simulation.result.retval) as unknown;
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
  const [grantValue, milestoneValue, totalValue] = await Promise.all([
    readContract(REGISTRY_CONTRACT_ID, "get_grant", [sc.u64(id)]),
    readContract(REGISTRY_CONTRACT_ID, "get_milestones", [sc.u64(id)]),
    readContract(ESCROW_CONTRACT_ID, "total", [sc.u64(id)]),
  ]);
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
