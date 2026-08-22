import {
  BASE_FEE,
  Contract,
  Horizon,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  CONTRACT_ID,
  HORIZON_URL,
  IMPACT_ESCROW_CONTRACT_ID,
  IMPACT_REGISTRY_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  READ_ONLY_SOURCE,
  RPC_URL,
} from "../config";
import type { FriendlyError, PollResults, TransactionStage, VoteEvent } from "../types";
import { sc, submitContractCall } from "./transaction";

const rpcServer = new rpc.Server(RPC_URL);
const horizonServer = new Horizon.Server(HORIZON_URL);
const signalsContract = new Contract(CONTRACT_ID);

function buildCall(source: Awaited<ReturnType<typeof rpcServer.getAccount>>, method: string, ...args: ReturnType<typeof nativeToScVal>[]) {
  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(signalsContract.call(method, ...args))
    .setTimeout(60)
    .build();
}

export async function readResults(): Promise<PollResults> {
  if (import.meta.env.MODE === "e2e") {
    return {
      question: "What should Stellar build next?",
      options: ["Payments", "Identity", "Climate", "Gaming"],
      counts: [12, 8, 17, 6],
      total: 43,
    };
  }
  const source = await rpcServer.getAccount(READ_ONLY_SOURCE);
  const simulation = await rpcServer.simulateTransaction(buildCall(source, "get_results"));

  if (rpc.Api.isSimulationError(simulation) || !simulation.result) {
    throw new Error(
      rpc.Api.isSimulationError(simulation)
        ? simulation.error
        : "The contract returned no poll data.",
    );
  }

  const result = scValToNative(simulation.result.retval) as PollResults;
  return {
    question: result.question,
    options: result.options,
    counts: result.counts.map(Number),
    total: Number(result.total),
  };
}

export async function readXlmBalance(address: string): Promise<number> {
  if (import.meta.env.MODE === "e2e") return 5_000;
  try {
    const account = await horizonServer.loadAccount(address);
    const native = account.balances.find((balance) => balance.asset_type === "native");
    return native ? Number(native.balance) : 0;
  } catch (cause) {
    const status = (cause as { response?: { status?: number }; status?: number }).response?.status
      ?? (cause as { status?: number }).status;
    if (status === 404) return 0;
    throw cause;
  }
}

export async function fundTestnetAccount(address: string): Promise<number> {
  if (import.meta.env.MODE === "e2e") return 10_000;
  const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`FRIENDBOT_FAILED:${response.status}:${detail.slice(0, 180)}`);
  }
  return readXlmBalance(address);
}

export async function submitVote(
  address: string,
  option: number,
  onStage: (stage: TransactionStage) => void,
): Promise<string> {
  return submitContractCall({
    address,
    contractId: CONTRACT_ID,
    method: "vote",
    label: "Cast signal",
    args: [sc.address(address), sc.u32(option)],
    onUpdate: ({ stage }) => onStage(stage),
  });
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function parseVoteEvent(event: rpc.Api.EventResponse): VoteEvent | null {
  const topics = event.topic.map((topic) => scValToNative(topic));
  if (topics[0] !== "vote_cast") return null;

  const value = scValToNative(event.value) as {
    option_total?: number;
    total?: number;
  };

  return {
    id: event.id,
    voter: shortAddress(String(topics[1])),
    option: Number(topics[2]),
    optionTotal: Number(value.option_total ?? 0),
    total: Number(value.total ?? 0),
    txHash: event.txHash,
    ledger: event.ledger,
    closedAt: event.ledgerClosedAt,
  };
}

export async function fetchVoteEvents(cursor?: string) {
  const filters: rpc.Api.EventFilter[] = [
    { type: "contract", contractIds: [CONTRACT_ID] },
  ];

  const response = cursor
    ? await rpcServer.getEvents({ filters, cursor, limit: 40 })
    : await rpcServer.getLatestLedger().then((latest) =>
        rpcServer.getEvents({
          filters,
          startLedger: Math.max(1, latest.sequence - 2_000),
          limit: 40,
        }),
      );

  return {
    cursor: response.cursor,
    events: response.events
      .map(parseVoteEvent)
      .filter((event): event is VoteEvent => event !== null),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error !== "object" || error === null) return String(error);

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (typeof record.error === "object" && record.error !== null) {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }

  return String(error);
}

export function friendlyError(error: unknown): FriendlyError {
  const raw = errorMessage(error);
  const message = raw.toLowerCase();
  const contractCode = Number(message.match(/#(\d+)/)?.[1] ?? 0);
  const signalsError = Boolean(CONTRACT_ID && message.includes(CONTRACT_ID.toLowerCase()));
  const impactRegistryError = Boolean(
    IMPACT_REGISTRY_CONTRACT_ID && message.includes(IMPACT_REGISTRY_CONTRACT_ID.toLowerCase()),
  );
  const impactEscrowError = Boolean(
    IMPACT_ESCROW_CONTRACT_ID && message.includes(IMPACT_ESCROW_CONTRACT_ID.toLowerCase()),
  );

  if (raw === "WRONG_NETWORK" || message.includes("network passphrase")) {
    return {
      code: "WRONG_NETWORK",
      title: "Switch to Testnet",
      message: "This poll only accepts signatures from Stellar Testnet. Change your wallet network and reconnect.",
    };
  }

  if (raw === "WALLET_ACCOUNT_CHANGED") {
    return {
      code: "WALLET_UNAVAILABLE",
      title: "Wallet account changed",
      message: "The active wallet account changed before signing. Review the new account, then start the action again.",
    };
  }

  if (raw === "INSUFFICIENT_BALANCE" || raw === "INSUFFICIENT_SPENDABLE_BALANCE" || message.includes("insufficient") || message.includes("underfunded")) {
    return {
      code: "INSUFFICIENT_BALANCE",
      title: "Not enough Testnet XLM",
      message: "Keep at least 1.5 XLM available for the account reserve and contract transaction fee, then try again.",
    };
  }

  if (message.includes("friendbot_failed")) {
    return {
      code: "NETWORK_ERROR",
      title: "Friendbot could not fund this account",
      message: "Friendbot only funds eligible Stellar Testnet accounts. Refresh the balance or try again after the service recovers.",
    };
  }

  if (raw === "IMPACT_NOT_DEPLOYED") {
    return {
      code: "IMPACT_NOT_DEPLOYED",
      title: "Proof-to-Payout is not deployed",
      message: "Public Signals and Level 3 grants remain available. Configure the versioned Impact Registry and Escrow Testnet addresses to enable Level 4 actions.",
    };
  }

  if (raw === "DUPLICATE_ACTION_PENDING") {
    return {
      code: "NETWORK_ERROR",
      title: "Action already in progress",
      message: "Wait for the current wallet request or transaction hash to finish before trying this action again.",
    };
  }

  if (raw === "GRANTS_NOT_DEPLOYED") {
    return {
      code: "GRANTS_NOT_DEPLOYED",
      title: "Grant contracts pending deployment",
      message: "Discovery is available in preview mode. Add the Registry and Escrow Testnet addresses to enable wallet actions.",
    };
  }

  if (raw === "PENDING_TIMEOUT" || message.includes("pending_timeout")) {
    return {
      code: "PENDING_TIMEOUT",
      title: "Confirmation is taking longer",
      message: "The transaction may still confirm. Use the preserved Explorer link to check its neutral pending status.",
    };
  }

  if (raw === "INVALID_EVIDENCE_FILE") {
    return { code: "INVALID_EVIDENCE_FILE", title: "Evidence file is not accepted", message: "Use a non-empty PDF, JPEG, PNG, WebP, text, CSV, or JSON file no larger than 20 MB." };
  }
  if (raw === "EVIDENCE_HASH_MISMATCH") {
    return { code: "EVIDENCE_HASH_MISMATCH", title: "Evidence integrity check failed", message: "The stored bytes did not match the browser SHA-256. The hash was not anchored; choose the original file and retry." };
  }
  if (raw === "EVIDENCE_UPLOAD_FAILED") {
    return { code: "EVIDENCE_UPLOAD_FAILED", title: "Evidence was not stored", message: "The evidence service is unavailable or rejected the upload. Nothing was anchored; retry when storage is healthy." };
  }

  if (impactRegistryError && contractCode) {
    if (contractCode === 3) return { code: "CONTRACT_PAUSED", title: "Contract temporarily paused", message: "This lifecycle action is paused. Public reads and eligible refunds remain available." };
    if ([4, 14, 15].includes(contractCode)) return { code: "UNAUTHORIZED_REVIEWER", title: "This account cannot perform that role", message: "Use the assigned, accepted account and check that creator, payout, reviewer, arbitrator, and contributor roles do not conflict." };
    if (contractCode === 11) return { code: "UNSUPPORTED_ASSET", title: "Asset is not allowlisted", message: "Create this project with an enabled Testnet asset and an amount inside its immutable policy." };
    if (contractCode === 20) return { code: "DUPLICATE_VOTE", title: "Contributor decision already recorded", message: "This account already voted for this milestone attempt. The on-chain receipt prevents duplicates." };
    if (contractCode === 21) return { code: "DUPLICATE_ATTESTATION", title: "Reviewer decision already recorded", message: "This reviewer already attested to this exact evidence attempt." };
    if (contractCode === 23) return { code: "EVIDENCE_HASH_MISMATCH", title: "Evidence hash does not match", message: "Reload the project and verify the content hash before signing another review or vote." };
    if (contractCode === 27) return { code: "DISPUTED_MILESTONE", title: "Milestone is under dispute", message: "Payout is frozen until the arbitrator threshold or dispute timeout resolves it." };
    if ([17, 18, 25, 26, 28].includes(contractCode)) return { code: "FUNDING_CLOSED", title: "The stage is still open", message: "This permissionless finalizer is only valid after the current funding, activation, review, voting, or dispute deadline." };
    if ([6, 7, 8, 9, 10, 12, 13, 16, 24].includes(contractCode)) return { code: "INVALID_GRANT", title: "Project transition is not valid", message: "Reload direct contract state and check the project stage, immutable policy, roles, deadline, schedule, and remaining evidence attempts." };
    if (contractCode === 19) return { code: "NO_VOTING_POWER", title: "No contributor voting power", message: "Only eligible contributors can vote; creator, payout, reviewer, and arbitrator accounts are excluded." };
  }
  if (impactEscrowError && contractCode) {
    if (contractCode === 3) return { code: "CONTRACT_PAUSED", title: "Escrow mutation is paused", message: "Risky custody changes are paused. Eligible refund claims remain available." };
    if (contractCode === 12) return { code: "UNSUPPORTED_ASSET", title: "Asset is not allowlisted", message: "The Escrow only accepts explicitly enabled assets with verified decimals and amount limits." };
    if ([18, 19].includes(contractCode)) return { code: "REFUND_UNAVAILABLE", title: "Refund is not available", message: "The project has not enabled refunds or this account has no remaining refundable contribution." };
    if (contractCode === 20) return { code: "DUPLICATE_REFUND", title: "Refund already claimed", message: "The Escrow receipt shows this account already claimed its share." };
    if ([9, 10].includes(contractCode)) return { code: "FUNDING_CLOSED", title: "Contribution cannot be accepted", message: "The funding window, exact goal, or per-contributor cap prevents this contribution." };
    if ([14, 15, 16, 17].includes(contractCode)) return { code: "UNAUTHORIZED_RELEASE", title: "Payout does not match the escrow schedule", message: "Only the next exact, Registry-approved milestone can be released once." };
  }
  if (signalsError && contractCode === 5) {
    return { code: "ALREADY_VOTED", title: "Signal already cast", message: "This account has already voted. The permanent Signals contract accepts one vote per address." };
  }

  if (
    message.includes("reject") ||
    message.includes("denied") ||
    message.includes("cancel") ||
    message.includes("closed") ||
    message.includes("no wallet selected")
  ) {
    return {
      code: "USER_REJECTED",
      title: "Request declined",
      message: "Nothing was submitted. Approve the wallet request when you are ready to cast your signal.",
    };
  }

  if (message.includes("alreadyvoted") || message.includes("already voted")) {
    return {
      code: "ALREADY_VOTED",
      title: "Signal already cast",
      message: "This account has already voted. The contract allows one permanent Testnet vote per address.",
    };
  }

  if (message.includes("duplicate milestone")) {
    return {
      code: "DUPLICATE_VOTE",
      title: "Milestone vote already cast",
      message: "This contributor has already voted on the current milestone.",
    };
  }

  if (message.includes("no voting power") || message.includes("novotingpower")) {
    return {
      code: "NO_VOTING_POWER",
      title: "No contributor voting power",
      message: "Only contributors can vote, and voting weight matches the XLM contributed to this grant.",
    };
  }

  if (message.includes("quorum")) {
    return {
      code: "QUORUM_NOT_MET",
      title: "Quorum not reached",
      message: "More contributor voting weight is required before this milestone can be finalized.",
    };
  }

  if (message.includes("approval")) {
    return {
      code: "APPROVAL_NOT_MET",
      title: "Approval threshold not reached",
      message: "The current weighted yes vote is below this grant's approval threshold.",
    };
  }

  if (message.includes("refund") || message.includes("alreadyrefunded")) {
    return {
      code: "REFUND_UNAVAILABLE",
      title: "Refund unavailable",
      message: "This contribution is not refundable yet, has already been claimed, or belongs to another account.",
    };
  }

  if (message.includes("paused")) {
    return {
      code: "CONTRACT_PAUSED",
      title: "Contract temporarily paused",
      message: "Financial changes are paused by the contract administrator. Reads and Explorer proof remain available.",
    };
  }

  if (message.includes("goal") || message.includes("milestone") || message.includes("deadline")) {
    return {
      code: "INVALID_GRANT",
      title: "Grant details are invalid",
      message: "Check the goal, future deadline, milestone total, and threshold values before trying again.",
    };
  }

  if (message.includes("wallet") || message.includes("extension") || message.includes("not found")) {
    return {
      code: "WALLET_UNAVAILABLE",
      title: "Wallet unavailable",
      message: "Install or unlock one of the supported wallets, then reconnect from the wallet picker.",
    };
  }

  return {
    code: "NETWORK_ERROR",
    title: "The transaction did not land",
    message: "The Stellar RPC request failed. Nothing is marked successful without final confirmation; check the status and retry.",
  };
}
