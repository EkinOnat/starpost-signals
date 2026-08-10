# Level 3 architecture

Starpost Signals uses the existing immutable Signals deployment as its category source and adds two contracts around it. The core product loop is **signal -> fund -> deliver**.

```text
Wallet
  |-- Signals: permanent category vote and VoteCast event
  |-- Registry: category validation, grant state, weighted votes
  `-- Escrow: contribution accounting, XLM custody, releases, refunds
             `-- native XLM Stellar Asset Contract

Stellar RPC -> cursor indexer -> JSON snapshot + SSE -> browser reducer
                                  `-> direct RPC polling fallback
```

## Contract composition

1. `create_grant` reads `get_results` on the existing Signals contract and rejects a category outside the current options.
2. Registry calls Escrow to open a vault, enable refunds, and release an approved milestone.
3. Escrow calls the native XLM asset contract for every contribution, release, and refund.

The milestone-finalization invocation is the strongest composition proof: one Registry call causes an Escrow release and native asset transfer in one transaction.

## Authorization tree

- A grant creator authorizes `Registry.create_grant` or `Registry.cancel_grant`.
- A contributor authorizes `Escrow.contribute`, `Registry.vote_milestone`, or `Escrow.claim_refund`.
- Registry-only Escrow methods require the configured Registry contract address. Immediate contract invoker authorization protects the nested call.
- Transfers from the Escrow contract are authorized by the Escrow contract as current invoker of the asset contract.
- Pause controls require the configured administrator.

## State and invariants

- Persistent vaults, contributions, grants, milestones, votes, and refund receipts extend their TTL during use.
- Funding stops at the exact goal or deadline and can never exceed the goal.
- Two to five positive milestones must sum exactly to the goal.
- Contributor voting weight equals recorded contribution; each account votes once per current milestone.
- Quorum and approval calculations use checked integer arithmetic and basis points.
- A milestone is released once, cumulative releases cannot exceed deposits, and a contribution is refunded once.
- Cancellation is limited to the funding phase so a full pro-rata refund remains solvent.

## Synchronization

The indexer polls all configured contracts with one RPC filter, persists the latest cursor and a materialized event/grant snapshot, and rejects duplicate event IDs. `/api/stream` broadcasts SSE frames and 15-second heartbeats. The browser fetches `/api/grants` and `/api/events`, applies live frames through the same pure reducer, and falls back to bounded direct RPC polling if the service is unavailable.

Confirmed user transactions trigger immediate snapshot reconciliation. Submitted transactions are never shown as successful before RPC returns `SUCCESS`, and the transaction hash survives pending, timeout, and failure states.

