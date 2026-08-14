# Level 4 testing

Run from the repository root:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
stellar contract build
npm run typecheck
npm test
npm run build
npm run build:indexer
npm run test:e2e
```

Current implemented local suites cover 60 Rust contract tests, frontend domain/component tests, indexer persistence/recovery/hash API/SSE tests, and the preserved mobile Playwright paths. Contract tests include real authorization assertions, role conflicts, contribution/vote caps, exact release ordering, refund conservation and rounding, pause semantics, deadlines, review, dispute, arbitration, rework, and terminal refunds.

Before public release, add Testnet smoke transactions for every V1 state branch and capture their hashes. Run Playwright at 320, 375, 390, 768, 1280, and 1440 pixels; keyboard-only and screen-reader checks; axe or equivalent accessibility automation; slow/offline/RPC failure scenarios; a 20 MiB evidence boundary test; sustained SSE reconnect; disk restore; and load tests that do not touch Testnet rate limits.

CI blocks contract format, Clippy, tests and build; frontend typecheck, tests and build; indexer build and tests; E2E; critical npm audit; and secret scanning.
