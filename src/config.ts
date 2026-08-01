import { Networks } from "@stellar/stellar-sdk";

export const CONTRACT_ID =
  import.meta.env.VITE_CONTRACT_ID ??
  "CBHWJQ6Q4FAKCTC5IOS5YJDB2AOP5EF4SE6ODOLACCZZ2B3GV34J3YIP";

export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const READ_ONLY_SOURCE =
  "GDR3XZ6CFDXHBU65A47HRWXYWDYX6TEN543RXWJ7D2MOHUXDUCT34FTR";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const EXPLORER_URL = "https://stellar.expert/explorer/testnet";
