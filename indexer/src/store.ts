import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { reduceActivity, type ActivityEvent, type GrantState } from "../../src/domain/grants.js";
import type { IndexedContractEvent } from "./event-codec.js";

const SCHEMA_VERSION = 2;
const MAX_PUBLIC_ACTIVITY = 2_000;
const MAX_CONTRACT_EVENTS = 20_000;
const MAX_DEDUPE_IDS = 100_000;

export type PersistedState = GrantState & {
  schemaVersion: number;
  cursor?: string;
  updatedAt: string;
  activityEventIds: string[];
  contractEvents: IndexedContractEvent[];
  contractEventIds: string[];
  metrics: Record<string, { count: number; lastSeenAt: string }>;
};

function emptyState(): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    grants: [],
    events: [],
    activityEventIds: [],
    contractEvents: [],
    contractEventIds: [],
    metrics: {},
    updatedAt: new Date(0).toISOString(),
  };
}

function validState(parsed: Partial<PersistedState>): PersistedState {
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Unsupported indexer state schema ${parsed.schemaVersion}`);
  }
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const contractEvents = Array.isArray(parsed.contractEvents) ? parsed.contractEvents : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    grants: Array.isArray(parsed.grants) ? parsed.grants : [],
    events,
    cursor: parsed.cursor,
    updatedAt: parsed.updatedAt || new Date(0).toISOString(),
    activityEventIds: Array.isArray(parsed.activityEventIds)
      ? parsed.activityEventIds
      : events.map((event) => event.id),
    contractEvents,
    contractEventIds: Array.isArray(parsed.contractEventIds)
      ? parsed.contractEventIds
      : contractEvents.map((event) => event.id),
    metrics: parsed.metrics && typeof parsed.metrics === "object" ? parsed.metrics : {},
  };
}

export class EventStore {
  private state: PersistedState = emptyState();
  private activityIds = new Set<string>();
  private contractIds = new Set<string>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load() {
    const backupPath = `${this.filePath}.bak`;
    let parsed: Partial<PersistedState> | null = null;
    try {
      parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedState>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      try {
        parsed = JSON.parse(await readFile(backupPath, "utf8")) as Partial<PersistedState>;
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code !== "ENOENT") throw backupError;
      }
    }
    this.state = parsed ? validState(parsed) : emptyState();
    this.activityIds = new Set(this.state.activityEventIds);
    this.contractIds = new Set(this.state.contractEventIds);
    return this.snapshot();
  }

  ingest(event: ActivityEvent) {
    if (this.activityIds.has(event.id)) return false;
    this.activityIds.add(event.id);
    const reduced = reduceActivity(this.state, event);
    this.state = {
      ...this.state,
      ...reduced,
      events: reduced.events.slice(0, MAX_PUBLIC_ACTIVITY),
      activityEventIds: this.appendId(this.state.activityEventIds, event.id, this.activityIds),
      updatedAt: new Date().toISOString(),
    };
    return true;
  }

  ingestContractEvent(event: IndexedContractEvent) {
    if (this.contractIds.has(event.id)) return false;
    this.contractIds.add(event.id);
    this.state.contractEvents = [event, ...this.state.contractEvents]
      .sort((left, right) => right.ledger - left.ledger)
      .slice(0, MAX_CONTRACT_EVENTS);
    this.state.contractEventIds = this.appendId(this.state.contractEventIds, event.id, this.contractIds);
    this.state.updatedAt = new Date().toISOString();
    return true;
  }

  private appendId(ids: string[], id: string, target: Set<string>) {
    const next = [...ids, id];
    if (next.length <= MAX_DEDUPE_IDS) return next;
    const removed = next.splice(0, next.length - MAX_DEDUPE_IDS);
    for (const removedId of removed) target.delete(removedId);
    return next;
  }

  setCursor(cursor: string) {
    this.state.cursor = cursor;
    this.state.updatedAt = new Date().toISOString();
  }

  recordMetric(event: string) {
    const previous = this.state.metrics[event];
    this.state.metrics[event] = {
      count: (previous?.count ?? 0) + 1,
      lastSeenAt: new Date().toISOString(),
    };
    this.state.updatedAt = new Date().toISOString();
  }

  async save() {
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    this.saving = this.saving.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      const backupPath = `${this.filePath}.bak`;
      await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
      try {
        await copyFile(this.filePath, backupPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await rename(temporaryPath, this.filePath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    });
    return this.saving;
  }

  snapshot(): PersistedState {
    return structuredClone(this.state);
  }
}
