import { useCallback, useEffect, useRef, useState } from "react";
import { GRANTS_ENABLED, INDEXER_URL } from "../config";
import {
  DEMO_GRANTS,
  applyActivitySnapshot,
  reduceActivity,
  type ActivityEvent,
  type GrantState,
  type GrantView,
  type SyncStatus,
} from "../domain/grants";
import { fetchActivityEvents } from "../lib/events";
import { readGrantView } from "../lib/grant-client";

const INITIAL_STATE: GrantState = {
  grants: import.meta.env.MODE === "e2e" || !GRANTS_ENABLED ? DEMO_GRANTS : [],
  events: [],
};

export function useGrants() {
  const [state, setState] = useState<GrantState>(INITIAL_STATE);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const cursor = useRef<string | undefined>(undefined);
  const lastIndexedEventId = useRef<string | null>(null);
  const hydrationAttempts = useRef(new Set<number>());

  const applyEvent = useCallback((event: ActivityEvent) => {
    setState((current) => reduceActivity(current, event));
  }, []);

  const reconcile = useCallback(async () => {
    if (INDEXER_URL) {
      try {
        const [grantResponse, eventResponse] = await Promise.all([
          fetch(`${INDEXER_URL}/api/v1/grants`),
          fetch(`${INDEXER_URL}/api/v1/events?limit=200`),
        ]);
        if (!grantResponse.ok || !eventResponse.ok) throw new Error("Indexer snapshot unavailable");
        const grantBody = (await grantResponse.json()) as { grants: GrantView[] };
        const eventBody = (await eventResponse.json()) as { events: ActivityEvent[]; cursor?: string; lastEventId?: string | null };
        cursor.current = eventBody.cursor;
        lastIndexedEventId.current = eventBody.lastEventId ?? eventBody.events[0]?.id ?? null;
        setState((current) => {
          const snapshot = applyActivitySnapshot(grantBody.grants, eventBody.events);
          const snapshotIds = new Set(snapshot.events.map((event) => event.id));
          const eventsReceivedDuringFetch = current.events
            .filter((event) => !snapshotIds.has(event.id))
            .sort((left, right) => left.ledger - right.ledger);
          return eventsReceivedDuringFetch.reduce(reduceActivity, snapshot);
        });
        return;
      } catch {
        // Direct RPC remains the read fallback. Contract reads—not the
        // indexer—are authoritative for every financial mutation.
      }
    }
    const page = await fetchActivityEvents(cursor.current);
    cursor.current = page.cursor;
    setState((current) => page.events.reduce(reduceActivity, current));
  }, []);

  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;
    let timer: number | null = null;
    let attempt = 0;

    if (import.meta.env.MODE === "e2e") {
      const channel = new BroadcastChannel("starpost-signals-e2e");
      const receive = (event: Event) => {
        const activity = (event as CustomEvent<ActivityEvent>).detail;
        applyEvent(activity);
        channel.postMessage(activity);
      };
      channel.onmessage = (message) => applyEvent(message.data as ActivityEvent);
      window.addEventListener("starpost:e2e-event", receive);
      setSyncStatus("live");
      return () => {
        active = false;
        window.removeEventListener("starpost:e2e-event", receive);
        channel.close();
      };
    }

    const poll = async () => {
      try {
        await reconcile();
        if (!active) return;
        attempt = 0;
        setSyncStatus("live");
        timer = window.setTimeout(() => void poll(), 8_000);
      } catch {
        if (!active) return;
        attempt += 1;
        setSyncStatus(attempt >= 3 ? "offline" : "retrying");
        timer = window.setTimeout(() => void poll(), Math.min(30_000, 2_000 * 2 ** attempt));
      }
    };

    if (INDEXER_URL && typeof EventSource !== "undefined") {
      void (async () => {
        try {
          await reconcile();
          if (!active) return;
          const after = lastIndexedEventId.current
            ? `?after=${encodeURIComponent(lastIndexedEventId.current)}`
            : "";
          source = new EventSource(`${INDEXER_URL}/api/v1/stream${after}`);
          source.onopen = () => active && setSyncStatus("live");
          source.onmessage = (message) => {
            try {
              const event = JSON.parse(message.data) as ActivityEvent;
              lastIndexedEventId.current = event.id;
              applyEvent(event);
            } catch {
              // A malformed SSE frame is isolated; the stream remains connected.
            }
          };
          source.onerror = () => {
            source?.close();
            source = null;
            if (active) {
              setSyncStatus("retrying");
              void poll();
            }
          };
        } catch {
          if (active) void poll();
        }
      })();
    } else {
      void poll();
    }

    return () => {
      active = false;
      source?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [applyEvent, reconcile]);

  useEffect(() => {
    const targets = state.grants.filter(
      (grant) => !grant.demo && grant.milestones.length === 0 && !hydrationAttempts.current.has(grant.id),
    );
    if (!targets.length) return;
    for (const target of targets) hydrationAttempts.current.add(target.id);
    void Promise.allSettled(targets.map((grant) => readGrantView(grant.id, grant))).then((results) => {
      setState((current) => ({
        ...current,
        grants: current.grants.map((grant) => {
          const targetIndex = targets.findIndex((target) => target.id === grant.id);
          if (targetIndex < 0) return grant;
          const result = results[targetIndex];
          return result.status === "fulfilled" ? result.value : grant;
        }),
      }));
    });
  }, [state.grants]);

  return { ...state, syncStatus, reconcile, applyEvent };
}
