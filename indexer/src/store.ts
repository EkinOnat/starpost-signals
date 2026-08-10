import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { reduceActivity, type ActivityEvent, type GrantState } from "../../src/domain/grants.js";

export type PersistedState = GrantState & { cursor?: string; updatedAt: string };

const EMPTY: PersistedState = { grants: [], events: [], updatedAt: new Date(0).toISOString() };

export class EventStore {
  private state: PersistedState = structuredClone(EMPTY);

  constructor(private readonly filePath: string) {}

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as PersistedState;
      this.state = {
        grants: Array.isArray(parsed.grants) ? parsed.grants : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        cursor: parsed.cursor,
        updatedAt: parsed.updatedAt || new Date(0).toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = structuredClone(EMPTY);
    }
    return this.snapshot();
  }

  ingest(event: ActivityEvent) {
    if (this.state.events.some((existing) => existing.id === event.id)) return false;
    const reduced = reduceActivity(this.state, event);
    this.state = { ...this.state, ...reduced, updatedAt: new Date().toISOString() };
    return true;
  }

  setCursor(cursor: string) {
    this.state.cursor = cursor;
    this.state.updatedAt = new Date().toISOString();
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  snapshot(): PersistedState {
    return structuredClone(this.state);
  }
}

