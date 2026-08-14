import { loadConfig } from "./config.js";
import { EventIndexer, StellarActivitySource } from "./poller.js";
import { createIndexerServer } from "./server.js";
import { EventStore } from "./store.js";
import { EvidenceStore } from "./evidence-store.js";

const config = loadConfig();
const store = new EventStore(config.dataFile);
await store.load();
const evidenceStore = new EvidenceStore(config.evidenceDataDir, config.evidenceMaxBytes);
await evidenceStore.initialize();

const log = (entry: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), service: "starpost-indexer", ...entry })}\n`);
};

let indexer: EventIndexer;
const api = createIndexerServer({
  store,
  evidenceStore,
  allowedOrigins: config.corsOrigins,
  rateLimitPerMinute: config.rateLimitPerMinute,
  health: () => indexer?.health() ?? { failures: 0, lastLedger: 0 },
  release: process.env.APP_RELEASE?.trim() || process.env.RENDER_GIT_COMMIT?.trim() || "development",
});
indexer = new EventIndexer(
  new StellarActivitySource(config.rpcUrl, config.contractIds, config.startLedger),
  store,
  config.pollIntervalMs,
  api.broadcast,
  log,
  config.maxReadyLagLedgers,
  api.broadcastContract,
);

api.server.listen(config.port, "0.0.0.0", () => {
  log({ level: "info", message: "server_started", port: config.port, contracts: config.contractIds.length });
  indexer.start();
});

async function shutdown(signal: string) {
  log({ level: "info", message: "shutdown_started", signal });
  indexer.stop();
  await store.save();
  api.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
