# Level 5 analytics and operations

## Public service deployment

Deploy `render.yaml` as the `starpost-signals-indexer` web service with its persistent disk. After the service is healthy, set these Vercel production variables and redeploy the frontend:

```text
VITE_INDEXER_URL=https://<public-indexer-host>
VITE_EVIDENCE_API_URL=https://<public-indexer-host>
VITE_FEEDBACK_FORM_URL=https://docs.google.com/forms/d/e/<form-id>/viewform
VITE_APP_RELEASE=<immutable-git-sha-or-release-tag>
```

No browser analytics identifier, wallet, transaction hash, form answer, or free-text property is sent to telemetry.

## Release smoke checks

```text
GET /health                  → 200, release, uptime, cursor, ledger status
GET /ready                   → 200 only when the poller is inside the configured lag limit
GET /api/v1/metrics          → aggregate event counts and last-seen timestamps
GET /api/v1/contract-events  → versioned on-chain audit records
```

Verify HTTPS, persistent-disk recovery, CORS for `https://starpost-signals.vercel.app`, rate limiting, restart behavior, and a release value matching the deployed commit. `/health` can stay green during temporary RPC lag; `/ready` is the release/readiness gate.

## Growth funnel

Calculate these values from aggregate metrics for one clearly labeled release/date window:

| Metric | Definition |
| --- | --- |
| Persona selections | `onboarding_role_selected` |
| Wallet readiness | `onboarding_wallet_ready / onboarding_role_selected` |
| Action start | `onboarding_action_started / onboarding_wallet_ready` |
| Confirmed activation | `onboarding_action_confirmed / onboarding_role_selected` |
| Feedback handoff | `feedback_opened / onboarding_action_confirmed` |
| Form completion | Qualified private form records divided by `feedback_opened` |
| Seven-day repeat activity | Qualified users with a second distinct verified transaction divided by 50 |

Counts are best-effort and respect Do Not Track, so the on-chain cohort verifier—not telemetry—is the submission source of truth.

## Evidence captures

Capture dated screenshots after deployment showing:

- the public onboarding role and readiness journey;
- an RPC-confirmed transaction and Explorer link;
- `/ready` with acceptable ledger lag;
- `/api/v1/metrics` with the release and funnel event counts;
- the public activity/audit view;
- the Vercel deployment and green GitHub Actions run; and
- uptime/restart evidence if an external monitor is configured.

Redact browser account details, raw form responses, emails, names, unconsented wallets, service tokens, environment variables, and logs containing private paths.

## Incident rules

- Pause recruitment if wallet connection, signing, confirmation, Form access, or verifier correctness is broken.
- Never count a transaction until both RPC and Horizon report success.
- Preserve pending hashes without classifying them as success or failure prematurely.
- Roll back the frontend if activation falls because of a release regression; do not change deployed contracts for a presentation deadline.
- Keep eligible refunds and direct contract reads available when the indexer is degraded.
