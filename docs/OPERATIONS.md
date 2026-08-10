# Operations and recovery

## Indexer

- Health: `GET /health`
- Snapshots: `GET /api/grants` and `GET /api/events?limit=200`
- Stream: `GET /api/stream`
- Persistence: set `INDEXER_DATA_FILE` to a mounted persistent-disk path.
- Recovery: stop the process, restore the last state file if available, and restart. If the file is absent, the service backfills the latest 2,000 ledgers and resumes from the returned cursor.
- Logs are structured JSON and exclude secrets.

## RPC degradation

The service retries with bounded exponential backoff. The browser reports `retrying` or `offline`, then uses direct RPC event polling. Financial actions do not depend on indexer availability.

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

