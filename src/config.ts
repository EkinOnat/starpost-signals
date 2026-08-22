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

export const IMPACT_REGISTRY_CONTRACT_ID = (
  import.meta.env.VITE_IMPACT_REGISTRY_CONTRACT_ID ??
  "CBHNVYK2YL4FWYETEMN2HCAEYEMMJTL4MQWY4PODMMYFKTIJLNURG6T3"
).trim();

export const IMPACT_ESCROW_CONTRACT_ID = (
  import.meta.env.VITE_IMPACT_ESCROW_CONTRACT_ID ??
  "CAB4Y37SZ3XUYG3OMGQQECXTE5IYQXXI23UFF2V4RBDV76AIHGMGK3PJ"
).trim();

export const EVIDENCE_API_URL = (
  import.meta.env.VITE_EVIDENCE_API_URL ?? import.meta.env.VITE_INDEXER_URL ?? ""
).replace(/\/$/, "");

export const APP_RELEASE = (import.meta.env.VITE_APP_RELEASE ?? "development").trim();

export const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL ?? "").replace(/\/$/, "");

export const FEEDBACK_FORM_URL = (import.meta.env.VITE_FEEDBACK_FORM_URL ?? "").trim();

export const GRANTS_ENABLED = Boolean(REGISTRY_CONTRACT_ID && ESCROW_CONTRACT_ID);
export const IMPACT_ENABLED = Boolean(
  IMPACT_REGISTRY_CONTRACT_ID && IMPACT_ESCROW_CONTRACT_ID,
);

export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const READ_ONLY_SOURCE =
  "GDR3XZ6CFDXHBU65A47HRWXYWDYX6TEN543RXWJ7D2MOHUXDUCT34FTR";

const DEPLOYED_TEST_GRANTS: Readonly<Record<string, readonly number[]>> = {
  CCLUIBA3E7CILJOQYPYLV46W67U5HHR5PVQP4UEC6KTCYHWGZ5OFICHQ: [2],
};

function grantIdSet(raw: unknown, fallback: readonly number[]): ReadonlySet<number> {
  const source = raw === undefined ? fallback.map(String) : String(raw).split(",");
  return new Set(
    source
      .map((value) => Number(String(value).trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
}

// Test records are operator-tagged by grant id for each deployed Registry. An
// explicit empty VITE_TEST_GRANT_IDS value disables the deployment manifest.
export const TEST_GRANT_IDS = grantIdSet(
  import.meta.env.VITE_TEST_GRANT_IDS,
  DEPLOYED_TEST_GRANTS[REGISTRY_CONTRACT_ID] ?? [],
);

function bounded(raw: unknown, fallback: number, minimum: number, maximum: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

// Grant discovery reads the Registry directly instead of replaying events. The
// deployed Registry has no enumeration getter, so the allocator (NextGrantId in
// contract instance storage) supplies the exact upper bound. These limits only
// cap the fallback probe that runs when the allocator cannot be read, and they
// guarantee discovery is never an unbounded RPC scan.
export const MAX_DISCOVERABLE_GRANT_ID = bounded(
  import.meta.env.VITE_MAX_GRANT_ID,
  100,
  1,
  2_000,
);
export const GRANT_DISCOVERY_CONCURRENCY = bounded(
  import.meta.env.VITE_GRANT_DISCOVERY_CONCURRENCY,
  4,
  1,
  16,
);
export const GRANT_READ_TIMEOUT_MS = bounded(
  import.meta.env.VITE_GRANT_READ_TIMEOUT_MS,
  15_000,
  1_000,
  60_000,
);

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const EXPLORER_URL = "https://stellar.expert/explorer/testnet";
