const REQUIRED_FIELDS = [
  "timestamp",
  "name",
  "email",
  "wallet_address",
  "transaction_hash",
  "contract_id",
  "action",
  "role",
  "overall_rating",
  "wallet_ease",
  "flow_clarity",
  "milestone_understanding",
  "payout_trust",
  "most_confusing_step",
  "most_valuable_feature",
  "improvement_request",
  "would_use_again",
  "testnet_acknowledgement",
  "consent_verification",
  "consent_anonymized_publication",
];

const ROLES = new Set(["supporter", "contributor", "creator", "reviewer"]);
const ACTIONS = new Set([
  "signal_vote",
  "grant_created",
  "grant_contribution",
  "milestone_vote",
  "project_created",
  "role_accepted",
  "impact_contribution",
  "evidence_submitted",
  "reviewer_attestation",
  "contributor_vote",
  "arbitration_vote",
  "payout_released",
  "refund_claimed",
]);
const REUSE = new Set(["yes", "no", "maybe"]);
const TRUE_VALUES = new Set(["true", "yes", "y", "1", "checked"]);

export function parseCsv(text) {
  const records = [];
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
      if (row.some((value) => value !== "")) records.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  const [headers = [], ...values] = records;
  return values.map((items) => Object.fromEntries(headers.map((header, index) => [header.trim(), (items[index] ?? "").trim()])));
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, headers) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvField).join(","))
    .join("\n")}\n`;
}

function consent(value) {
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function rating(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5;
}

function normalizedEmail(value) {
  return String(value).trim().toLowerCase();
}

function redactFreeText(value, row) {
  let redacted = String(value ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (name.length >= 2) redacted = redacted.replaceAll(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[name removed]");
  return redacted
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/G[A-Z2-7]{55}/g, "[wallet removed]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[hash removed]");
}

export function validateCohortRows(rows, options) {
  const {
    approvedContracts,
    isValidAddress,
    minimum = 50,
  } = options;
  const emails = new Set();
  const wallets = new Set();
  const transactions = new Set();
  const valid = [];
  const failures = [];

  for (const [index, row] of rows.entries()) {
    const participant = `L5-${String(index + 1).padStart(3, "0")}`;
    const errors = [];
    for (const field of REQUIRED_FIELDS) if (!String(row[field] ?? "").trim()) errors.push(`missing ${field}`);
    const email = normalizedEmail(row.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid email");
    else {
      if (emails.has(email)) errors.push("duplicate email");
      emails.add(email);
    }
    const wallet = String(row.wallet_address ?? "").trim();
    if (!isValidAddress(wallet)) errors.push("invalid Stellar public address");
    else {
      if (wallets.has(wallet)) errors.push("duplicate wallet address");
      wallets.add(wallet);
    }
    const hash = String(row.transaction_hash ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) errors.push("invalid transaction hash");
    else {
      if (transactions.has(hash)) errors.push("duplicate transaction hash");
      transactions.add(hash);
    }
    if (!approvedContracts.has(String(row.contract_id ?? "").trim())) errors.push("contract is not approved");
    if (!ROLES.has(String(row.role ?? "").trim().toLowerCase())) errors.push("invalid role");
    if (!ACTIONS.has(String(row.action ?? "").trim().toLowerCase())) errors.push("invalid action");
    for (const field of ["overall_rating", "wallet_ease", "flow_clarity", "milestone_understanding", "payout_trust"]) {
      if (!rating(row[field])) errors.push(`${field} must be an integer from 1 to 5`);
    }
    if (!REUSE.has(String(row.would_use_again ?? "").trim().toLowerCase())) errors.push("invalid would_use_again response");
    if (Number.isNaN(Date.parse(String(row.timestamp ?? "")))) errors.push("invalid timestamp");
    if (!consent(row.testnet_acknowledgement)) errors.push("Testnet acknowledgement is required");
    if (!consent(row.consent_verification)) errors.push("verification consent is required");
    if (!consent(row.consent_anonymized_publication)) errors.push("anonymized-publication consent is required");

    if (errors.length) failures.push({ participant, row: index + 2, errors });
    else {
      valid.push({ participant, row: { ...row, email, wallet_address: wallet, transaction_hash: hash } });
    }
  }

  return {
    minimum,
    submitted: rows.length,
    locallyValid: valid.length,
    quotaMet: valid.length >= minimum,
    valid,
    failures,
  };
}

export const SANITIZED_HEADERS = [
  "participant_id",
  "timestamp",
  "wallet_address",
  "transaction_hash",
  "explorer_url",
  "contract_id",
  "action",
  "role",
  "overall_rating",
  "wallet_ease",
  "flow_clarity",
  "milestone_understanding",
  "payout_trust",
  "most_confusing_step",
  "most_valuable_feature",
  "improvement_request",
  "would_use_again",
  "verification_status",
];

export function sanitizeValidRows(validRows) {
  return validRows.map(({ participant, row }) => ({
    participant_id: participant,
    timestamp: new Date(row.timestamp).toISOString(),
    wallet_address: row.wallet_address,
    transaction_hash: row.transaction_hash,
    explorer_url: `https://stellar.expert/explorer/testnet/tx/${row.transaction_hash}`,
    contract_id: row.contract_id,
    action: row.action,
    role: String(row.role).toLowerCase(),
    overall_rating: Number(row.overall_rating),
    wallet_ease: Number(row.wallet_ease),
    flow_clarity: Number(row.flow_clarity),
    milestone_understanding: Number(row.milestone_understanding),
    payout_trust: Number(row.payout_trust),
    most_confusing_step: redactFreeText(row.most_confusing_step, row),
    most_valuable_feature: redactFreeText(row.most_valuable_feature, row),
    improvement_request: redactFreeText(row.improvement_request, row),
    would_use_again: String(row.would_use_again).toLowerCase(),
    verification_status: "pending_onchain_verification",
  }));
}
