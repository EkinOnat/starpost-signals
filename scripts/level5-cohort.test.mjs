import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SANITIZED_HEADERS,
  parseCsv,
  sanitizeValidRows,
  toCsv,
  validateCohortRows,
} from "./lib/level5-cohort.mjs";

const CONTRACT = "CAPPROVED";

function record(patch = {}) {
  return {
    timestamp: "2026-08-22T12:00:00Z",
    name: "Amina Example",
    email: "amina@example.org",
    wallet_address: `G${"A".repeat(55)}`,
    transaction_hash: "a".repeat(64),
    contract_id: CONTRACT,
    action: "signal_vote",
    role: "supporter",
    overall_rating: "5",
    wallet_ease: "4",
    flow_clarity: "4",
    milestone_understanding: "4",
    payout_trust: "5",
    most_confusing_step: "Amina Example needed help; amina@example.org",
    most_valuable_feature: "Public proof",
    improvement_request: `Shorten ${"a".repeat(64)} and G${"B".repeat(55)}`,
    would_use_again: "yes",
    testnet_acknowledgement: "true",
    consent_verification: "true",
    consent_anonymized_publication: "true",
    ...patch,
  };
}

const options = {
  approvedContracts: new Set([CONTRACT]),
  isValidAddress: (value) => /^G[A-Z]{55}$/.test(value),
  minimum: 1,
};

describe("Level 5 cohort evidence", () => {
  it("accepts a complete unique consented record", () => {
    const result = validateCohortRows([record()], options);
    assert.equal(result.locallyValid, 1);
    assert.equal(result.quotaMet, true);
    assert.deepEqual(result.failures, []);
  });

  it("rejects duplicate emails, wallets, and transaction hashes", () => {
    const result = validateCohortRows([record(), record({ name: "Second Person" })], { ...options, minimum: 2 });
    assert.equal(result.locallyValid, 1);
    assert.deepEqual(result.failures[0].errors, ["duplicate email", "duplicate wallet address", "duplicate transaction hash"]);
  });

  it("reserves identity and transaction evidence from an invalid earlier row", () => {
    const result = validateCohortRows([
      record({ consent_verification: "false" }),
      record({ name: "Second Person" }),
    ], { ...options, minimum: 2 });

    assert.equal(result.locallyValid, 0);
    assert.ok(result.failures[0].errors.includes("verification consent is required"));
    assert.deepEqual(result.failures[1].errors, ["duplicate email", "duplicate wallet address", "duplicate transaction hash"]);
  });

  it("rejects malformed ratings, unapproved contracts, and missing consent", () => {
    const result = validateCohortRows([record({ overall_rating: "6", contract_id: "COTHER", consent_verification: "false" })], options);
    assert.ok(result.failures[0].errors.includes("contract is not approved"));
    assert.ok(result.failures[0].errors.includes("overall_rating must be an integer from 1 to 5"));
    assert.ok(result.failures[0].errors.includes("verification consent is required"));
  });

  it("removes identity, emails, extra wallets, and hashes from public comments", () => {
    const result = validateCohortRows([record()], options);
    const [sanitized] = sanitizeValidRows(result.valid);
    const serialized = JSON.stringify(sanitized);
    assert.ok(!serialized.includes("Amina Example"));
    assert.ok(!serialized.includes("amina@example.org"));
    assert.ok(serialized.includes("[name removed]"));
    assert.ok(serialized.includes("[wallet removed]"));
    assert.ok(serialized.includes("[hash removed]"));
  });

  it("round-trips quoted public feedback through CSV", () => {
    const result = validateCohortRows([record({ improvement_request: "Add guides, examples, and roles" })], options);
    const sanitized = sanitizeValidRows(result.valid);
    const csv = toCsv(sanitized, SANITIZED_HEADERS);
    assert.equal(parseCsv(csv)[0].improvement_request, "Add guides, examples, and roles");
  });
});
