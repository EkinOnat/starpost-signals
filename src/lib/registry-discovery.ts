import {
  GRANTS_ENABLED,
  GRANT_DISCOVERY_CONCURRENCY,
  MAX_DISCOVERABLE_GRANT_ID,
} from "../config";
import type { GrantView } from "../domain/grants";
import {
  grantExists,
  isMissingGrantError,
  readGrantView,
  readLatestLedger,
  readRegistryNextGrantId,
} from "./grant-client";

/**
 * Direct-from-contract grant discovery.
 *
 * The Grants page used to learn which grants exist only from `GrantCreated`
 * events, which the RPC event window drops after a few thousand ledgers. This
 * module makes persisted Registry state authoritative instead: it enumerates
 * grant ids from the contract, reads each one, and reports failures rather than
 * presenting an empty registry.
 *
 * Enumeration order:
 *   1. the Registry's `NextGrantId` allocator (exact, one RPC call);
 *   2. a bounded probe of `1..MAX_DISCOVERABLE_GRANT_ID` when the allocator is
 *      unreadable — never an unbounded scan.
 *
 * Ids supplied by events or the indexer are unioned in and de-duplicated, so
 * discovery is a superset of what the event pipeline can see.
 */

/** How many consecutive all-failed batches end a scan instead of burning budget. */
const FAILED_BATCH_ABORT = 2;

export type GrantIdSource = "allocator" | "probe";

export type DiscoveryResult = {
  grants: GrantView[];
  /** Ids the Registry definitively does not hold (contract GrantNotFound). */
  missingIds: number[];
  /** Ids whose authoritative read failed. Non-empty means "show retry". */
  failedIds: number[];
  syncedLedger: number | null;
  source: GrantIdSource;
};

export type DiscoveryPorts = {
  readNextGrantId: () => Promise<number | null>;
  grantExists: (id: number) => Promise<boolean>;
  readGrant: (id: number, current?: GrantView) => Promise<GrantView>;
  readLatestLedger: () => Promise<number>;
  isMissingGrant: (error: unknown) => boolean;
};

export type DiscoveryOptions = {
  /** Ids already seen through events or the indexer; merged with contract ids. */
  knownIds?: number[];
  /** Current views, used to keep human-written copy across refreshes. */
  current?: GrantView[];
  maxGrantId?: number;
  concurrency?: number;
};

const defaultPorts: DiscoveryPorts = {
  readNextGrantId: readRegistryNextGrantId,
  grantExists,
  readGrant: readGrantView,
  readLatestLedger,
  isMissingGrant: isMissingGrantError,
};

function range(from: number, to: number) {
  const ids: number[] = [];
  for (let id = from; id <= to; id += 1) ids.push(id);
  return ids;
}

function batches<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type Outcome =
  | { id: number; status: "loaded"; grant: GrantView }
  | { id: number; status: "missing" }
  | { id: number; status: "failed" };

async function resolveCandidateIds(
  ports: DiscoveryPorts,
  maxGrantId: number,
  concurrency: number,
): Promise<{ ids: number[]; source: GrantIdSource; failedIds: number[] }> {
  const allocator = await ports.readNextGrantId().catch(() => null);
  if (allocator !== null && allocator > 1) {
    return { ids: range(1, Math.min(allocator - 1, maxGrantId)), source: "allocator", failedIds: [] };
  }
  if (allocator === 1) return { ids: [], source: "allocator", failedIds: [] };

  // Allocator unavailable: probe the documented range. Missing ids never stop
  // the scan, so a gap cannot hide a later valid id; only repeated transport
  // failures do, and those surface as a retryable error instead of an empty page.
  const found: number[] = [];
  const failedIds: number[] = [];
  const candidates = range(1, maxGrantId);
  let failedBatches = 0;
  for (const [index, batch] of batches(candidates, concurrency).entries()) {
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          return { id, exists: await ports.grantExists(id) } as const;
        } catch {
          return { id, exists: null } as const;
        }
      }),
    );
    for (const result of results) {
      if (result.exists === true) found.push(result.id);
      else if (result.exists === null) failedIds.push(result.id);
    }
    if (results.every((result) => result.exists === null)) {
      failedBatches += 1;
      if (failedBatches >= FAILED_BATCH_ABORT) {
        failedIds.push(...candidates.slice((index + 1) * concurrency));
        break;
      }
    } else {
      failedBatches = 0;
    }
  }
  return { ids: found, source: "probe", failedIds };
}

export async function discoverRegistryGrants(
  options: DiscoveryOptions = {},
  ports: DiscoveryPorts = defaultPorts,
): Promise<DiscoveryResult> {
  if (!GRANTS_ENABLED) {
    return { grants: [], missingIds: [], failedIds: [], syncedLedger: null, source: "allocator" };
  }
  const maxGrantId = Math.max(1, options.maxGrantId ?? MAX_DISCOVERABLE_GRANT_ID);
  const concurrency = Math.max(1, options.concurrency ?? GRANT_DISCOVERY_CONCURRENCY);
  const currentById = new Map((options.current ?? []).map((grant) => [grant.id, grant]));

  const [ledgerResult, candidates] = await Promise.all([
    ports.readLatestLedger().then(
      (sequence) => sequence,
      () => null,
    ),
    resolveCandidateIds(ports, maxGrantId, concurrency),
  ]);

  const known = (options.knownIds ?? []).filter(
    (id) => Number.isSafeInteger(id) && id >= 1 && id <= maxGrantId,
  );
  const ids = [...new Set([...candidates.ids, ...known])].sort((left, right) => left - right);

  const grants: GrantView[] = [];
  const missingIds: number[] = [];
  const failedIds = [...candidates.failedIds];
  let failedBatches = 0;
  const chunks = batches(ids, concurrency);
  for (const [index, batch] of chunks.entries()) {
    const outcomes = await Promise.all(
      batch.map(async (id): Promise<Outcome> => {
        try {
          return { id, status: "loaded", grant: await ports.readGrant(id, currentById.get(id)) };
        } catch (error) {
          return ports.isMissingGrant(error)
            ? { id, status: "missing" }
            : { id, status: "failed" };
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "loaded") grants.push(outcome.grant);
      else if (outcome.status === "missing") missingIds.push(outcome.id);
      else failedIds.push(outcome.id);
    }
    if (outcomes.every((outcome) => outcome.status === "failed")) {
      failedBatches += 1;
      if (failedBatches >= FAILED_BATCH_ABORT) {
        failedIds.push(...chunks.slice(index + 1).flat());
        break;
      }
    } else {
      failedBatches = 0;
    }
  }

  const syncedLedger = ledgerResult;
  return {
    grants: grants
      .map((grant) => (syncedLedger === null ? grant : { ...grant, syncedLedger }))
      .sort((left, right) => right.id - left.id),
    missingIds,
    failedIds: [...new Set(failedIds)].sort((left, right) => left - right),
    syncedLedger,
    source: candidates.source,
  };
}
