import { readFile } from "node:fs/promises";
import { Networks, rpc, scValToNative, StrKey } from "@stellar/stellar-sdk";

const [, , csvPath = "docs/level4/evidence/user-interactions.csv", manifestPath = "docs/level4/evidence/contract-deployment.json"] = process.argv;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(field); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows;
  return values.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.network !== "testnet" || manifest.status === "not_deployed") throw new Error("Deployment manifest is not a completed Testnet deployment");
const approvedContracts = new Set(Object.entries(manifest).filter(([key, value]) => /contractid$/i.test(key) && typeof value === "string").map(([, value]) => value));
const rows = parseCsv(await readFile(csvPath, "utf8"));
if (rows.length < 10) throw new Error(`Expected at least 10 interactions, found ${rows.length}`);

const transactionHashes = new Set();
const participantAddresses = new Set();
const participantAliases = new Set();
const server = new rpc.Server(process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org");
const horizon = (process.env.HORIZON_URL || "https://horizon-testnet.stellar.org").replace(/\/$/, "");
const failures = [];

for (const [index, row] of rows.entries()) {
  const label = row.participant_alias || `row ${index + 2}`;
  try {
    if (!label || participantAliases.has(label)) throw new Error("duplicate or missing participant alias");
    participantAliases.add(label);
    const address = row.public_address_or_consented_identifier;
    if (!StrKey.isValidEd25519PublicKey(address)) throw new Error("a full valid public address is required for reproducible verification");
    if (participantAddresses.has(address)) throw new Error("duplicate participant address");
    participantAddresses.add(address);
    if (!/^[0-9a-f]{64}$/i.test(row.transaction_hash) || transactionHashes.has(row.transaction_hash)) throw new Error("invalid or duplicate transaction hash");
    transactionHashes.add(row.transaction_hash);
    if (!approvedContracts.has(row.contract_id)) throw new Error("contract is not present in the deployment manifest");

    const transaction = await server.getTransaction(row.transaction_hash);
    if (transaction.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`RPC transaction status is ${transaction.status}`);
    if (row.ledger && Number(row.ledger) !== transaction.ledger) throw new Error("recorded ledger does not match RPC");

    const horizonTransaction = await fetch(`${horizon}/transactions/${row.transaction_hash}`).then(async (response) => {
      if (!response.ok) throw new Error(`Horizon transaction lookup returned ${response.status}`);
      return response.json();
    });
    if (!horizonTransaction.successful) throw new Error("Horizon marks the transaction unsuccessful");

    const eventPage = await server.getEvents({
      startLedger: transaction.ledger,
      filters: [{ type: "contract", contractIds: [...approvedContracts] }],
      limit: 200,
    });
    const matching = eventPage.events.filter((event) => event.txHash === row.transaction_hash && event.contractId?.toString() === row.contract_id);
    if (!matching.length) throw new Error("no event from the recorded Starpost contract was found");
    const eventText = JSON.stringify(matching.map((event) => ({
      topics: event.topic.map((topic) => jsonSafe(scValToNative(topic))),
      value: jsonSafe(scValToNative(event.value)),
    })));
    if (horizonTransaction.source_account !== address && !eventText.includes(address)) {
      throw new Error("participant address is neither transaction source nor event actor");
    }
    const expectedExplorer = `https://stellar.expert/explorer/testnet/tx/${row.transaction_hash}`;
    if (row.explorer_url && row.explorer_url !== expectedExplorer) throw new Error("Explorer URL does not match the transaction hash");
  } catch (error) {
    failures.push({ participant: label, error: error instanceof Error ? error.message : String(error) });
  }
}

const report = {
  networkPassphrase: Networks.TESTNET,
  checkedAt: new Date().toISOString(),
  participants: participantAddresses.size,
  transactions: transactionHashes.size,
  passed: rows.length - failures.length,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (participantAddresses.size < 10 || transactionHashes.size < 10 || failures.length) process.exitCode = 1;
