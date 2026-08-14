# Impact V1 contract API

## Registry

Administrative: `initialize`, `set_asset_policy`, `set_pause_mode`, `propose_governor`, `accept_governor`, `version`.

Project/funding: `create_project`, `update_draft`, `accept_reviewer`, `accept_arbitrator`, `open_funding`, `contribute`, `finalize_funding`, `activate_project`, `cancel_project`, `apply_timeout`.

Proof/decision: `submit_evidence`, `open_review`, `attest`, `finalize_review`, `open_voting`, `vote`, `finalize_vote`, `arbitrate`, `finalize_dispute`, `start_rework`, `release_milestone`.

Reads/maintenance: `project_count`, `get_config`, `get_asset_policy`, `get_project`, `get_milestones`, `get_evidence`, `role_accepted`, `has_voted`, `get_attestation`, `get_vote`, `get_arbitration_vote`, `touch_project`.

Every project snapshots the standard `ProtocolPolicy`: exactly 3 reviewers/3 arbitrators, 2-of-3 thresholds, minimum 2 contributors, quorum/approval/dispute basis points, contribution/voting caps, at most 2 evidence attempts, and bounded funding/activation/review/vote/arbitration/rework windows.

## Escrow

Administrative: `initialize`, `set_asset_policy`, `sync_asset_policy`, `set_pause_mode`, `propose_governor`, `accept_governor`, `version`.

Registry custody: `open_vault`, `deposit`, `lock_funding`, `release_milestone`, `enable_refunds`.

Contributor/public: `claim_refund`, `get_config`, `get_asset_policy`, `get_vault`, `total`, `contribution`, `release_receipt`, `refund_receipt`, `touch_vault`.

Escrow stores the immutable payout, asset, exact milestone schedule, deadline, caps, deposits, releases, refundable pool, contributor count, next milestone, and one-time receipts. Wallets cannot directly open/release/enable a vault.

## Events

Events are versioned with `schema_version = 1` and cover initialization/policy/pause/governance; project and milestone state changes; role acceptance; contribution/funding; evidence, reviewer, contributor, and arbitration decisions; release; refund enablement and claims. The indexer preserves the raw topic/value envelope rather than using it to authorize state.
