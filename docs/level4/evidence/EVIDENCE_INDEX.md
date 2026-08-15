# Evidence index

Status: contracts, production frontend, desktop UI, 390px responsive product metrics, public CI/deployment monitoring, and basic stakeholder feedback are documented. Ten independent wallet interactions, independent end-user feedback, the public indexer/evidence service, and the Level 4 demo video remain pending.

Each captured artifact must record filename, UTC capture date, what it proves, requirement, related live URL/transaction, redactions, and verifier. Preserve originals outside the repository when they contain full consented identifiers.

Expected directories: `analytics/`, `monitoring/`, `desktop/`, `mobile/`, `transactions/`, and `feedback/`. Do not commit fabricated or placeholder screenshots.

| Artifact | Captured UTC | Evidence | Public reference |
| --- | --- | --- | --- |
| `docs/screenshots/level4-proof-desktop.png` | 2026-08-14 | Deployed Proof-to-Payout UI and public on-chain summary | https://starpost-signals.vercel.app |
| `docs/screenshots/level3-mobile-ui.png` | 2026-08-13 | 390px responsive product UI and aggregate raised/active/released metrics | https://starpost-signals.vercel.app |
| GitHub Actions run `31851234105` | 2026-08-14 | Hosted Contracts, Frontend, Indexer, E2E, and Security monitoring all successful | https://github.com/EkinOnat/starpost-signals/actions/runs/31851234105 |
| `contract-deployment.json` | 2026-08-14 | V1 addresses, roles, WASM hashes, and six successful Testnet transactions | Stellar Testnet |
