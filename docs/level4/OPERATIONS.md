# Level 4 operations

## Pre-deployment

1. Protect the GitHub `testnet` environment and add `TESTNET_DEPLOYER_SECRET` without logging it.
2. Choose a separately controlled pause-guardian public address.
3. Run every command in `TESTING.md` from a clean checkout.
4. Review the standard policy and XLM allowlist values in `deploy-impact-v1.yml`.
5. Dispatch the workflow and download its manifest and exact WASM artifacts.
6. Independently compare artifact hashes and inspect `version() == 1` on both addresses.
7. Record deployment and initialization transaction hashes. Do not populate evidence from guesses or workflow logs alone.
8. Configure the indexer first, verify `/ready`, then configure and deploy the frontend.

## Public service endpoints

- `GET /health`: process liveness, release, cursor, last/latest ledger, lag, last success.
- `GET /ready`: 200 only when the poller is caught up; otherwise 503.
- `GET /api/v1/grants`, `GET /api/v1/events`: legacy materialized grant data.
- `GET /api/v1/contract-events`: versioned raw events with `after`, `limit`, and optional `projectId`.
- `GET /api/v1/stream`, `GET /api/v1/contract-stream`: resumable activity and raw-event SSE.
- `PUT /api/v1/metadata/:sha256`: canonical JSON verified against its path.
- `POST /api/v1/evidence/uploads`, `PUT /api/v1/evidence/uploads/:id`: reserved, size/type/hash-verified upload.
- `GET /api/v1/evidence/:sha256`: immutable sandboxed attachment.

## Alerts

- Page when `/ready` is non-200 for 10 minutes.
- Warn at 10 ledgers of lag; page at 20 ledgers or three consecutive RPC failures.
- Warn above 2% 5xx responses for five minutes; page above 5%.
- Warn at 70% disk usage and page at 85%.
- Page on a stored-file hash mismatch, failed backup, or repeated cursor regression.
- Alert before any contract/key live-until ledger is within 100,000 ledgers.

## TTL and archival

Contract getters simulated by the browser do **not** persist TTL extensions. A submitted maintenance invocation or user mutation does. V1 exposes `touch_project(project_id, actors)` and `touch_vault(project_id, contributors)` to bump the complete known record set, plus the Stellar CLI can extend contract instance/code TTL.

At the read-only audit ledger 4,143,590, the existing Testnet contracts and active Level 3 grant entries had only about 37,400 ledgers remaining; the earliest observed live-until ledger was 4,180,959 (approximately 2026-08-17 at the observed close rate). Expiry on current protocol means archival/restore cost and availability impact, not proven permanent deletion. The project owner should submit extensions immediately, verify the resulting live-until ledgers, and then operate a signed keeper. This repository does not claim that action was performed.

Keeper inputs must include every project contributor, reviewer, and arbitrator so account-scoped contribution, refund, vote, attestation, arbitration, and role receipts are touched. Monitor instance, code, project, milestone, evidence, vault, policy, and receipt keys. Treat `restoring_state` as a recoverable transaction state and pre-restore before a public demo.

## Incident response

1. Confirm direct RPC state and transaction status; never infer a payout from the indexer.
2. For unsafe new activity, guardian selects `PauseNewActivity`. For an active exploit, select `PauseRiskyMutations`; refunds remain available.
3. Preserve contract IDs, ledgers, transactions, service logs, release ID, and hashes.
4. Rotate compromised service secrets. A governor change uses propose/accept; the guardian cannot unpause.
5. Restore the persistent disk from a tested snapshot, start the indexer, and wait for `/ready`.
6. Deploy a new additive version if contract logic must change. Never relabel the old address.

## Rollback

Frontend rollback means restoring the previous immutable deployment and its environment. Service rollback means running the previous image against a compatible snapshot; state schema rejects unknown newer versions. Contracts are not upgraded in place: pause, preserve refunds, deploy an additive version, and publish an explicit migration decision.

## Backups

Snapshot `INDEXER_DATA_FILE`, its `.bak`, and `EVIDENCE_DATA_DIR` daily. Weekly, restore into an isolated service, verify random metadata and evidence SHA-256 values, and replay from the saved cursor. Retain deployment manifests and WASM independently from the application host.
