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
  const hydrationAttempts = useRef(new Set<number>());

  const applyEvent = useCallback((event: ActivityEvent) => {
    setState((current) => reduceActivity(current, event));
  }, []);

  const reconcile = useCallback(async () => {
    if (INDEXER_URL) {
      const [grantResponse, eventResponse] = await Promise.all([
        fetch(`${INDEXER_URL}/api/grants`),
        fetch(`${INDEXER_URL}/api/events?limit=200`),
      ]);
      if (!grantResponse.ok || !eventResponse.ok) throw new Error("Indexer snapshot unavailable");
      const grantBody = (await grantResponse.json()) as { grants: GrantView[] };
      const eventBody = (await eventResponse.json()) as { events: ActivityEvent[] };
      setState(applyActivitySnapshot(grantBody.grants, eventBody.events));
      return;
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
      void reconcile().catch(() => undefined);
      source = new EventSource(`${INDEXER_URL}/api/stream`);
      source.onopen = () => active && setSyncStatus("live");
      source.onmessage = (message) => {
        try {
          applyEvent(JSON.parse(message.data) as ActivityEvent);
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
