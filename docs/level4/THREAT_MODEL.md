# Level 4 threat model

| Threat | Implemented control | Residual / operation |
| --- | --- | --- |
| Unauthorized release | Only Registry-authenticated Escrow call; exact ordered receipt | V1 requires independent audit before Mainnet |
| Reviewer collusion | 3 independent accepted reviewers, 2-of-3 immutable threshold, role conflicts rejected | Off-chain truth cannot be proven solely by code |
| Contributor whale dominance | 50% contribution cap and 25% per-account voting-power cap | Sybil accounts remain possible |
| Duplicate approval/replay | Account, project, milestone, attempt-scoped persistent receipts; evidence hash bound into decision | Keep receipt TTL maintained |
| Unsafe nested call | Checks-effects-interactions, Registry-only custody calls, balance-delta validation | Malicious assets remain disabled unless governor allowlists them |
| Overflow/rounding | Checked Rust arithmetic; i128 atomic amounts; final refund claimant receives only residual dust | Asset decimals must be independently verified before allowlisting |
| Evidence replacement | SHA-256 content and canonical metadata commitments; immutable content address | Availability depends on backups; a hash does not prove truth |
| Personal/file abuse | Public-data warning, type and 20 MiB caps, attachment disposition, CSP sandbox, no inline rendering | Moderation/takedown policy is still required for public hosting |
| Admin key compromise | Separate governor/guardian, two-step governor, guardian may pause but not unpause | Use hardware or multisig custody before Mainnet |
| Pause abuse | Two modes; full pause freezes effective deadlines; claims remain available | Governance availability remains operational risk |
| TTL archival | 2M-ledger target, public touch methods, instance bump on mutations | Signed keeper and explicit restore UX are required |
| RPC/indexer disagreement | Direct RPC preflight/confirmation and contract reads are financial authority | UI should label stale/offline indexed history |
| Frontend config tampering | Contract IDs visible, deployment manifest + WASM hash verification, wallet network/account recheck | Compromised origin can still mislead users before wallet review |
| Supply chain | Exact npm versions, Cargo lock, Dependabot, audit, Clippy, secret scan, protected deploy | Pin Actions by commit SHA before a high-value deployment |
| Secret leakage | No secret keys in browser/config/artifacts; protected environment secret | Review demo recordings and build logs |
| Analytics privacy | Track pseudonymous session and action categories, never evidence or full wallet | Analytics is not yet configured; owner must select/consent to a provider |

## Explicit limitations

- Testnet only; no real asset value, fiat claim, custody promise, or regulatory representation.
- Starpost is not an anchor, bank, custodian, KYC provider, or compliance provider.
- Local cash-out is future capability unless a real supported anchor integration is separately reviewed and deployed.
- No independent security audit has been completed.
