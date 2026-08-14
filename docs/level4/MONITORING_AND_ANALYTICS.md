# Monitoring and analytics

The service exposes deployment release, uptime, RPC failures, last processed/current ledger, lag, last success, cursor, and readiness. Configure an external uptime monitor against `/health` and `/ready`; the repository cannot create or claim an external account or screenshot.

The frontend sends best-effort aggregate product event names to `/api/v1/telemetry` unless Do Not Track is enabled. The API accepts only a fixed allowlist and persists only count and last-seen time. It discards properties, full wallets, evidence, transaction hashes, and personal identifiers. `/api/v1/metrics` exposes the aggregate counts needed for a basic funnel:

- wallet attempted → connected / failed
- project viewed → created
- contribution started → confirmed
- evidence started → confirmed
- reviewer attestation → contributor vote/dispute → payout/refund

Events include onboarding, wallet, project, contribution, evidence, reviewer, vote, dispute, payout, refund, and feedback milestones. Provider-specific error monitoring may be added later only after owner approval, data-processing review, release tagging, sampling, source-map controls, and redaction. Analytics or monitoring failure must never block a wallet action.

Submission screenshots should show the public `/ready` response, ledger lag, uptime history, error-rate alert, deployment release, disk alert, aggregate funnel, and a clearly visible date range. Do not include full wallets, evidence content, secrets, or unredacted participant data.
