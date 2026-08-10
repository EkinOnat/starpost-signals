import { Networks } from "@stellar/stellar-sdk";

export const CONTRACT_ID =
  import.meta.env.VITE_CONTRACT_ID ??
  "CBHWJQ6Q4FAKCTC5IOS5YJDB2AOP5EF4SE6ODOLACCZZ2B3GV34J3YIP";

export const REGISTRY_CONTRACT_ID =
  import.meta.env.VITE_REGISTRY_CONTRACT_ID ??
  "CCLUIBA3E7CILJOQYPYLV46W67U5HHR5PVQP4UEC6KTCYHWGZ5OFICHQ";

export const ESCROW_CONTRACT_ID =
  import.meta.env.VITE_ESCROW_CONTRACT_ID ??
  "CADLWMML7RAV2INFHOYA3QNGELSORVXV7LORDBYMJJMLXTVZHGT5NRLK";

export const NATIVE_ASSET_CONTRACT_ID =
  import.meta.env.VITE_NATIVE_ASSET_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL ?? "").replace(/\/$/, "");

export const GRANTS_ENABLED = Boolean(REGISTRY_CONTRACT_ID && ESCROW_CONTRACT_ID);

export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const READ_ONLY_SOURCE =
  "GDR3XZ6CFDXHBU65A47HRWXYWDYX6TEN543RXWJ7D2MOHUXDUCT34FTR";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const EXPLORER_URL = "https://stellar.expert/explorer/testnet";
