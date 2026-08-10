# Threat model

## Protected assets

- Contributor Testnet XLM held by Escrow
- Grant lifecycle and milestone release state
- Per-contributor balances, voting weight, and refund rights
- Administrator pause authority
- Event cursor and materialized activity integrity

## Trust boundaries

- Wallets sign user authorization; the frontend never receives a secret key.
- Stellar RPC is an external availability and data source boundary.
- Registry is the only authority allowed to open, release, or mark Escrow vaults refundable.
- The indexer is an availability aid, not a financial authority. Contract calls remain possible when it is offline.

## Controls

| Threat | Control |
| --- | --- |
| Unauthorized grant/cancel/contribution/vote/refund | Soroban `require_auth` on the relevant address |
| Direct Escrow release or refund enablement | Configured Registry address must authorize the call |
| Overfunding or over-release | Exact goal cap and checked cumulative accounting |
| Duplicate vote or refund | Persistent account-scoped receipts |
| Invalid milestone schedule | Positive two-to-five schedule with exact goal equality |
| Arithmetic overflow | Checked addition and multiplication |
| Partial-release insolvency on cancel | Cancellation allowed only during funding |
| Misleading transaction success | RPC-confirmed state machine; hash retained on timeout/failure |
| Stream replay or duplicate events | Persistent cursor plus event-ID deduplication |
| API abuse | Strict CORS allowlist, per-IP rate limiting, time-bounded retries, security headers |
| Leaked deployment credentials | GitHub Environment secret; no secret in source, frontend, logs, or artifacts |

## Known residual risks

- This release is Testnet-only and has not received an independent contract audit.
- Contributor voting measures capital committed, not unique humans.
- The Registry does not judge off-chain milestone evidence; contributors make that decision.
- A paused contract temporarily blocks financial mutations. Reads and Explorer evidence remain available.
- A lost or expired persistent entry after its extended TTL would require an operational migration; regular activity and maintenance should extend TTL before that point.
