import {
  Address,
  BASE_FEE,
  Contract,
  Horizon,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  type xdr,
} from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE, RPC_URL } from "../config";
import type { TransactionStage } from "../types";
import { signTransaction } from "./wallet";

const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

async function availableXlm(address: string) {
  const account = await horizon.loadAccount(address);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  if (!native) return 0;
  const accountRecord = account as typeof account & {
    subentry_count?: number;
    num_sponsoring?: number;
    num_sponsored?: number;
  };
  const reserveEntries = Math.max(
    2,
    2 +
      Number(accountRecord.subentry_count ?? 0) +
      Number(accountRecord.num_sponsoring ?? 0) -
      Number(accountRecord.num_sponsored ?? 0),
  );
  const sellingLiabilities = Number(
    "selling_liabilities" in native ? native.selling_liabilities : 0,
  );
  // Simulation remains authoritative; this preflight only prevents an
  // obviously unspendable native-asset request from reaching the wallet.
  return Math.max(
    0,
    Number(native.balance) - sellingLiabilities - reserveEntries * 0.5 - 0.1,
  );
}

export type TransactionUpdate = {
  stage: TransactionStage;
  hash?: string;
};

export const sc = {
  address: (value: string) => new Address(value).toScVal(),
  bool: (value: boolean) => nativeToScVal(value),
  i128: (value: number | bigint) => nativeToScVal(BigInt(value), { type: "i128" }),
  u32: (value: number) => nativeToScVal(value, { type: "u32" }),
  u64: (value: number | bigint) => nativeToScVal(BigInt(value), { type: "u64" }),
  string: (value: string) => nativeToScVal(value, { type: "string" }),
  native: (value: unknown) => nativeToScVal(value),
};

type ContractCallInput = {
  address: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  label: string;
  spendXlm?: number;
  onUpdate: (update: TransactionUpdate) => void;
};

export async function submitContractCall(input: ContractCallInput): Promise<string> {
  if (import.meta.env.MODE === "e2e") {
    const hash = "e2e0000000000000000000000000000000000000000000000000000000000000";
    for (const stage of ["validating", "simulating", "awaiting_signature", "submitted", "pending"] as const) {
      input.onUpdate({ stage, hash: stage === "submitted" || stage === "pending" ? hash : undefined });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    input.onUpdate({ stage: "confirmed", hash });
    return hash;
  }
  input.onUpdate({ stage: "validating" });
  const spendable = await availableXlm(input.address);
  if (spendable < (input.spendXlm ?? 0)) {
    throw new Error("INSUFFICIENT_SPENDABLE_BALANCE");
  }

  input.onUpdate({ stage: "simulating" });
  const account = await server.getAccount(input.address);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(input.contractId).call(input.method, ...input.args))
    .setTimeout(90)
    .build();
  let prepared: Awaited<ReturnType<typeof server.prepareTransaction>>;
  try {
    prepared = await server.prepareTransaction(transaction);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`SIMULATION_FAILED:${input.contractId}:${input.method}:${detail}`);
  }

  input.onUpdate({ stage: "awaiting_signature" });
  const { signedTxXdr } = await signTransaction(prepared.toXDR(), input.address);
  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);

  const submitted = await server.sendTransaction(signed);
  if (submitted.status === "ERROR") throw new Error(`SUBMISSION_FAILED:${input.label}`);
  input.onUpdate({ stage: "submitted", hash: submitted.hash });
  input.onUpdate({ stage: "pending", hash: submitted.hash });

  const result = await server.pollTransaction(submitted.hash, {
    attempts: 30,
    sleepStrategy: () => 1_000,
  });
  if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    input.onUpdate({ stage: "timed_out", hash: submitted.hash });
    const timeout = new Error("PENDING_TIMEOUT") as Error & { hash?: string };
    timeout.hash = submitted.hash;
    throw timeout;
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    const failed = new Error(`TRANSACTION_FAILED:${result.status}`) as Error & { hash?: string };
    failed.hash = submitted.hash;
    throw failed;
  }
  input.onUpdate({ stage: "confirmed", hash: submitted.hash });
  return submitted.hash;
}
