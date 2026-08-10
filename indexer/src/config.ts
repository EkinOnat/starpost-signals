import { resolve } from "node:path";

const SIGNALS_DEFAULT = "CBHWJQ6Q4FAKCTC5IOS5YJDB2AOP5EF4SE6ODOLACCZZ2B3GV34J3YIP";

function contractId(name: string, fallback = "") {
  const value = process.env[name]?.trim() || fallback;
  if (value && !/^C[A-Z2-7]{55}$/.test(value)) throw new Error(`${name} must be a Stellar contract address`);
  return value;
}
function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export type IndexerConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const signals = contractId("SIGNALS_CONTRACT_ID", SIGNALS_DEFAULT);
  const registry = contractId("REGISTRY_CONTRACT_ID");
  const escrow = contractId("ESCROW_CONTRACT_ID");
  return {
    port: positiveInteger("PORT", 8787),
    rpcUrl: process.env.STELLAR_RPC_URL?.trim() || "https://soroban-testnet.stellar.org",
    contractIds: [signals, registry, escrow].filter(Boolean),
    dataFile: resolve(process.env.INDEXER_DATA_FILE?.trim() || ".data/indexer-state.json"),
    pollIntervalMs: positiveInteger("POLL_INTERVAL_MS", 5_000),
    corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,https://starpost-signals.vercel.app")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitPerMinute: positiveInteger("RATE_LIMIT_PER_MINUTE", 120),
  };
}
