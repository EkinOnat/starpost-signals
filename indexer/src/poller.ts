import { rpc } from "@stellar/stellar-sdk";
import type { ActivityEvent } from "../../src/domain/grants.js";
import { decodeRpcEvent } from "./event-codec.js";
import type { EventStore } from "./store.js";

export type ActivityPage = { cursor: string; events: ActivityEvent[] };
export type ActivitySource = { page(cursor?: string): Promise<ActivityPage> };

export class StellarActivitySource implements ActivitySource {
  private readonly server: rpc.Server;
  constructor(rpcUrl: string, private readonly contractIds: string[]) {
    this.server = new rpc.Server(rpcUrl);
  }

  async page(cursor?: string): Promise<ActivityPage> {
    const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds: this.contractIds }];
    const response = cursor
      ? await this.server.getEvents({ filters, cursor, limit: 100 })
      : await this.server.getLatestLedger().then((ledger) =>
          this.server.getEvents({ filters, startLedger: Math.max(1, ledger.sequence - 2_000), limit: 100 }),
        );
    return {
      cursor: response.cursor,
      events: response.events.map(decodeRpcEvent).filter((event): event is ActivityEvent => event !== null),
    };
  }
}
export type IndexerLogger = (entry: Record<string, unknown>) => void;

export class EventIndexer {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private failures = 0;
  private lastLedger = 0;

  constructor(
    private readonly source: ActivitySource,
    private readonly store: EventStore,
    private readonly intervalMs: number,
    private readonly onEvent: (event: ActivityEvent) => void,
    private readonly log: IndexerLogger,
  ) {}

  async tick() {
    const snapshot = this.store.snapshot();
    const page = await this.source.page(snapshot.cursor);
    let accepted = 0;
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
    this.log({ level: "info", message: "events_ingested", accepted, cursor: page.cursor, lastLedger: this.lastLedger });
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
    return { failures: this.failures, lastLedger: this.lastLedger };
  }
}
