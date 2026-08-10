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
  const account = await horizonServer.loadAccount(address);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  return native ? Number(native.balance) : 0;
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

export function friendlyError(error: unknown): FriendlyError {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.toLowerCase();

  if (raw === "WRONG_NETWORK" || message.includes("network passphrase")) {
    return {
      code: "WRONG_NETWORK",
      title: "Switch to Testnet",
      message: "This poll only accepts signatures from Stellar Testnet. Change your wallet network and reconnect.",
    };
  }

  if (raw === "INSUFFICIENT_BALANCE" || message.includes("insufficient") || message.includes("underfunded")) {
    return {
      code: "INSUFFICIENT_BALANCE",
      title: "Not enough Testnet XLM",
      message: "Keep at least 1.5 XLM available for the account reserve and contract transaction fee, then try again.",
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

  if (
    message.includes("reject") ||
    message.includes("denied") ||
    message.includes("cancel") ||
    message.includes("no wallet selected")
  ) {
    return {
      code: "USER_REJECTED",
      title: "Request declined",
      message: "Nothing was submitted. Approve the wallet request when you are ready to cast your signal.",
    };
  }

  if (message.includes("#5") || message.includes("alreadyvoted") || message.includes("already voted")) {
    return {
      code: "ALREADY_VOTED",
      title: "Signal already cast",
      message: "This account has already voted. The contract allows one permanent Testnet vote per address.",
    };
  }

  if (message.includes("#13") || message.includes("duplicate milestone")) {
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
