# Operations and recovery

## Indexer

- Liveness/readiness: `GET /health` and `GET /ready`
- Snapshots: `GET /api/v1/grants`, `GET /api/v1/events`, and `GET /api/v1/contract-events`
- Streams: `GET /api/v1/stream` and `GET /api/v1/contract-stream`
- Persistence: set `INDEXER_DATA_FILE` to a mounted persistent-disk path.
- Recovery: stop the process, restore the state file or its last-valid `.bak`, and restart. A fresh service starts at the configured `INDEXER_START_LEDGER` within the RPC retention window and resumes from the returned cursor.
- Logs are structured JSON and exclude secrets.

## RPC degradation

The service retries with bounded exponential backoff. The browser reports `retrying` or `offline`, then uses direct RPC event polling. Financial actions and Level 4 project reads do not depend on indexer availability.

See [`level4/OPERATIONS.md`](level4/OPERATIONS.md) for the V1 evidence service, readiness alerts, backup, and urgent Testnet TTL runbook.

## Contract incident response

1. Use the administrator wallet to pause Registry and Escrow.
2. Preserve transaction hashes and current contract state.
3. Diagnose the invariant or external RPC issue without rotating user credentials.
4. Deploy corrected WASM as new contracts if migration is required; never silently replace addresses in evidence.
5. Update `deployments/testnet.json`, frontend environment variables, indexer filters, and the README together.

## Release checklist

- Contract format, Clippy, 40-test suite, optimized WASM, and hashes pass.
- Frontend and indexer typecheck, unit/integration tests, production builds, and three E2E flows pass.
- Testnet Registry/Escrow addresses and proof transactions are recorded.
- Frontend and indexer CORS/environment settings point to the production origins.
- Production smoke test covers Signals read/write, contribution, live activity, and Explorer links.
