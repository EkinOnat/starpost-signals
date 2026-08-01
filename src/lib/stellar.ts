import {
  Address,
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
import { signTransaction } from "./wallet";

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
  const account = await horizonServer.loadAccount(address);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  return native ? Number(native.balance) : 0;
}

export async function submitVote(
  address: string,
  option: number,
  onStage: (stage: TransactionStage) => void,
): Promise<string> {
  onStage("simulating");
  const balance = await readXlmBalance(address);
  if (balance < 1.5) {
    throw new Error("INSUFFICIENT_BALANCE");
  }

  const account = await rpcServer.getAccount(address);
  const transaction = buildCall(
    account,
    "vote",
    new Address(address).toScVal(),
    nativeToScVal(option, { type: "u32" }),
  );
  const prepared = await rpcServer.prepareTransaction(transaction);

  onStage("awaiting_signature");
  const { signedTxXdr } = await signTransaction(prepared.toXDR(), address);
  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);

  onStage("pending");
  const submitted = await rpcServer.sendTransaction(signed);
  if (submitted.status === "ERROR") {
    throw new Error(`Transaction submission failed: ${submitted.status}`);
  }

  const result = await rpcServer.pollTransaction(submitted.hash, {
    attempts: 20,
    sleepStrategy: () => 1_000,
  });
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction finished with status ${result.status}`);
  }

  return submitted.hash;
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

  if (message.includes("wallet") || message.includes("extension") || message.includes("not found")) {
    return {
      code: "WALLET_UNAVAILABLE",
      title: "Wallet unavailable",
      message: "Install or unlock one of the supported wallets, then reconnect from the wallet picker.",
    };
  }

  return {
    code: "NETWORK_ERROR",
    title: "The signal did not land",
    message: "The Stellar RPC request failed. Your vote was not confirmed; check the status and try again.",
  };
}
