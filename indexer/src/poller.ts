import { rpc } from "@stellar/stellar-sdk";
import type { ActivityEvent } from "../../src/domain/grants.js";
import { decodeIndexedRpcEvent, decodeRpcEvent, type IndexedContractEvent } from "./event-codec.js";
import type { EventStore } from "./store.js";

export type ActivityPage = {
  cursor: string;
  events: ActivityEvent[];
  contractEvents?: IndexedContractEvent[];
  latestLedger?: number;
  scannedLedger?: number;
};
export type ActivitySource = { page(cursor?: string): Promise<ActivityPage> };

export class StellarActivitySource implements ActivitySource {
  private readonly server: rpc.Server;
  constructor(
    rpcUrl: string,
    private readonly contractIds: string[],
    private readonly startLedger = 1,
  ) {
    this.server = new rpc.Server(rpcUrl);
  }

  async page(cursor?: string): Promise<ActivityPage> {
    const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds: this.contractIds }];
    const latest = await this.server.getLatestLedger();
    const response = cursor
      ? await this.server.getEvents({ filters, cursor, limit: 100 })
      : await this.server.getEvents({
          filters,
          startLedger: Math.max(this.startLedger, latest.sequence - 50_000),
          limit: 100,
        });
    return {
      cursor: response.cursor,
      events: response.events.map(decodeRpcEvent).filter((event): event is ActivityEvent => event !== null),
      contractEvents: response.events.map(decodeIndexedRpcEvent).filter((event): event is IndexedContractEvent => event !== null),
      latestLedger: latest.sequence,
      scannedLedger: response.events.length < 100
        ? latest.sequence
        : Math.max(...response.events.map((event) => event.ledger)),
    };
  }
}
export type IndexerLogger = (entry: Record<string, unknown>) => void;

export class EventIndexer {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private failures = 0;
  private lastLedger: number;
  private latestLedger = 0;
  private lastSuccessAt: string | null = null;

  constructor(
    private readonly source: ActivitySource,
    private readonly store: EventStore,
    private readonly intervalMs: number,
    private readonly onEvent: (event: ActivityEvent) => void,
    private readonly log: IndexerLogger,
    private readonly maxReadyLagLedgers = 20,
    private readonly onContractEvent?: (event: IndexedContractEvent) => void,
  ) {
    const snapshot = store.snapshot();
    this.lastLedger = Math.max(
      0,
      ...snapshot.events.map((event) => event.ledger),
      ...snapshot.contractEvents.map((event) => event.ledger),
    );
  }

  async tick() {
    const snapshot = this.store.snapshot();
    const page = await this.source.page(snapshot.cursor);
    this.lastLedger = Math.max(this.lastLedger, page.scannedLedger ?? 0);
    let accepted = 0;
    let acceptedContractEvents = 0;
    for (const event of page.contractEvents ?? []) {
      this.lastLedger = Math.max(this.lastLedger, event.ledger);
      if (this.store.ingestContractEvent(event)) {
        acceptedContractEvents += 1;
        this.onContractEvent?.(event);
      }
    }
    for (const event of page.events) {
      this.lastLedger = Math.max(this.lastLedger, event.ledger);
      if (this.store.ingest(event)) {
        accepted += 1;
        this.onEvent(event);
      }
    }
    this.store.setCursor(page.cursor);
    await this.store.save();
    this.failures = 0;
    this.latestLedger = page.latestLedger ?? Math.max(this.latestLedger, this.lastLedger);
    this.lastSuccessAt = new Date().toISOString();
    this.log({ level: "info", message: "events_ingested", accepted, acceptedContractEvents, cursor: page.cursor, lastLedger: this.lastLedger, latestLedger: this.latestLedger, lagLedgers: Math.max(0, this.latestLedger - this.lastLedger) });
    return accepted;
  }

  start() {
    this.stopped = false;
    const run = async () => {
      try {
        await this.tick();
      } catch (error) {
        this.failures += 1;
        this.log({ level: "error", message: "rpc_poll_failed", failures: this.failures, error: String(error) });
      }
      if (!this.stopped) {
        const delay = this.failures ? Math.min(30_000, this.intervalMs * 2 ** this.failures) : this.intervalMs;
        this.timer = setTimeout(() => void run(), delay);
      }
    };
    void run();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  health() {
    const lagLedgers = Math.max(0, this.latestLedger - this.lastLedger);
    return {
      ready: this.lastSuccessAt !== null && this.failures < 3 && lagLedgers <= this.maxReadyLagLedgers,
      failures: this.failures,
      lastLedger: this.lastLedger,
      latestLedger: this.latestLedger,
      lagLedgers,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
}
