import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Networks, rpc, scValToNative, StrKey } from "@stellar/stellar-sdk";
import {
  SANITIZED_HEADERS,
  parseCsv,
  sanitizeValidRows,
  toCsv,
  validateCohortRows,
} from "./lib/level5-cohort.mjs";

const [
  ,
  ,
  rawCsvPath,
  reportPath = "docs/level5/evidence/cohort-verification.json",
  sanitizedCsvPath = "docs/level5/evidence/sanitized-responses.csv",
  ...manifestPaths
] = process.argv;

if (!rawCsvPath) {
  process.stderr.write("Usage: npm run verify:level5 -- <private-raw.csv> [report.json] [sanitized.csv] [manifest.json ...]\n");
  process.exit(2);
}

const manifests = manifestPaths.length
  ? manifestPaths
  : ["deployments/testnet.json", "docs/level4/evidence/contract-deployment.json"];

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function collectContractIds(value, target = new Set()) {
  if (!value || typeof value !== "object") return target;
  for (const [key, item] of Object.entries(value)) {
    if (/contractid$/i.test(key) && typeof item === "string") target.add(item);
    else if (item && typeof item === "object") collectContractIds(item, target);
  }
  return target;
}

const actionEvents = {
  signal_vote: ["votecast", "votecast"],
  grant_created: ["grantcreated"],
  grant_contribution: ["contributionmade"],
  milestone_vote: ["milestonevotecast"],
  project_created: ["projectcreated"],
  role_accepted: ["roleaccepted"],
  impact_contribution: ["contributionrecorded"],
  evidence_submitted: ["evidencesubmitted"],
  reviewer_attestation: ["reviewerattested"],
  contributor_vote: ["milestonevotecast"],
  arbitration_vote: ["arbitrationvotecast"],
  payout_released: ["payoutreleased", "fundsreleased"],
  refund_claimed: ["refundclaimed"],
};

const normalizeEvent = (value) => String(value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

async function mapLimit(items, limit, handler) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  }));
  return results;
}

const approvedContracts = new Set();
for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.network !== "testnet" || manifest.status === "not_deployed") {
    throw new Error(`${path} is not a completed Testnet deployment manifest`);
  }
  collectContractIds(manifest, approvedContracts);
}

const rows = parseCsv(await readFile(rawCsvPath, "utf8"));
const local = validateCohortRows(rows, {
  approvedContracts,
  isValidAddress: (address) => StrKey.isValidEd25519PublicKey(address),
  minimum: 50,
});

const server = new rpc.Server(process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org");
const horizon = (process.env.HORIZON_URL || "https://horizon-testnet.stellar.org").replace(/\/$/, "");

const onchain = await mapLimit(local.valid, 5, async ({ participant, row }) => {
  try {
    const transaction = await server.getTransaction(row.transaction_hash);
    if (transaction.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`RPC status is ${transaction.status}`);
    const horizonTransaction = await fetch(`${horizon}/transactions/${row.transaction_hash}`).then(async (response) => {
      if (!response.ok) throw new Error(`Horizon lookup returned ${response.status}`);
      return response.json();
    });
    if (!horizonTransaction.successful) throw new Error("Horizon marks the transaction unsuccessful");

    const eventPage = await server.getEvents({
      startLedger: transaction.ledger,
      filters: [{ type: "contract", contractIds: [row.contract_id] }],
      limit: 200,
    });
    const events = eventPage.events.filter((event) => event.txHash === row.transaction_hash && event.contractId?.toString() === row.contract_id);
    if (!events.length) throw new Error("no event from the declared Starpost contract was found");
    const eventPayload = events.map((event) => ({
      topics: event.topic.map((topic) => jsonSafe(scValToNative(topic))),
      value: jsonSafe(scValToNative(event.value)),
    }));
    const expected = actionEvents[String(row.action).toLowerCase()] ?? [];
    const names = eventPayload.map((event) => normalizeEvent(event.topics[0]));
    if (!expected.some((name) => names.includes(name))) throw new Error(`declared action does not match contract event (${names.join(", ") || "none"})`);
    if (horizonTransaction.source_account !== row.wallet_address && !JSON.stringify(eventPayload).includes(row.wallet_address)) {
      throw new Error("wallet is neither transaction source nor event actor");
    }
    return { participant, passed: true, ledger: transaction.ledger };
  } catch (cause) {
    return { participant, passed: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
});

const chainFailures = onchain.filter((result) => !result.passed).map(({ participant, error }) => ({ participant, errors: [error] }));
const passedIds = new Set(onchain.filter((result) => result.passed).map((result) => result.participant));
const publicRows = sanitizeValidRows(local.valid.filter((record) => passedIds.has(record.participant)))
  .map((row) => ({ ...row, verification_status: "verified_rpc_horizon_event_actor" }));
const timestamps = publicRows.map((row) => Date.parse(row.timestamp)).filter(Number.isFinite).sort((left, right) => left - right);
const deepActions = publicRows.filter((row) => row.action !== "signal_vote").length;
const failures = [...local.failures, ...chainFailures];

const report = {
  schemaVersion: 1,
  network: "testnet",
  networkPassphrase: Networks.TESTNET,
  checkedAt: new Date().toISOString(),
  minimumQualifiedUsers: 50,
  submittedRows: rows.length,
  locallyValidRows: local.valid.length,
  qualifiedUsers: publicRows.length,
  uniqueTransactions: new Set(publicRows.map((row) => row.transaction_hash)).size,
  deeperLifecycleActions: deepActions,
  quotaMet: publicRows.length >= 50,
  deeperActionTargetMet: deepActions >= 10,
  campaignStartedAt: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
  campaignEndedAt: timestamps.length ? new Date(timestamps.at(-1)).toISOString() : null,
  approvedContracts: [...approvedContracts].sort(),
  failures,
};

await Promise.all([
  mkdir(dirname(reportPath), { recursive: true }),
  mkdir(dirname(sanitizedCsvPath), { recursive: true }),
]);
await Promise.all([
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(sanitizedCsvPath, toCsv(publicRows, SANITIZED_HEADERS), "utf8"),
]);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.quotaMet || !report.deeperActionTargetMet || failures.length) process.exitCode = 1;

