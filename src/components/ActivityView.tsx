import { EXPLORER_URL } from "../config";
import { mergeVerifiedActivity } from "../data/verified-activity";
import type { ActivityEvent, SyncStatus } from "../domain/grants";

const COPY: Record<ActivityEvent["kind"], { label: string; verb: string }> = {
  VoteCast: { label: "SIGNAL", verb: "cast a community signal" },
  GrantCreated: { label: "GRANT", verb: "created a new grant" },
  VaultOpened: { label: "ESCROW", verb: "opened an escrow vault" },
  ContributionMade: { label: "FUNDING", verb: "contributed to a grant" },
  FundingFinalized: { label: "ROUND", verb: "finalized grant funding" },
  MilestoneVoteCast: { label: "VOTE", verb: "voted on a milestone" },
  MilestoneApproved: { label: "APPROVAL", verb: "approved a milestone" },
  FundsReleased: { label: "RELEASE", verb: "released escrowed XLM" },
  RefundEnabled: { label: "REFUND", verb: "enabled contributor refunds" },
  RefundClaimed: { label: "CLAIM", verb: "claimed an escrow refund" },
  GrantCancelled: { label: "CANCEL", verb: "cancelled a grant" },
  GrantCompleted: { label: "COMPLETE", verb: "completed every milestone" },
};

export function ActivityView({ events, syncStatus }: { events: ActivityEvent[]; syncStatus: SyncStatus }) {
  const visibleEvents = mergeVerifiedActivity(events);
  const archiveIsFillingHistory = events.length === 0;
  const syncLabel = syncStatus === "live" && archiveIsFillingHistory
    ? "RPC CONNECTED"
    : syncStatus.toUpperCase();
  const syncCopy = syncStatus === "live"
    ? archiveIsFillingHistory
      ? "Direct RPC polling is connected. Verified Testnet history fills the public audit trail."
      : "SSE or direct RPC polling is receiving contract activity."
    : syncStatus === "connecting"
      ? "Opening the event stream. Verified history remains available."
      : "Verified Testnet history remains available while synchronization retries.";
  return (
    <div className="view activity-view">
      <section className="activity-hero"><div><span className="eyebrow"><i>04</i> VERIFY DELIVERY</span><h1>Every meaningful move,<br /><em>visible on-chain.</em></h1></div><div className={`sync-card sync-${syncStatus}`}><i /><span><small>NETWORK STATUS</small><strong>{syncLabel}</strong></span><p>{syncCopy}</p></div></section>
      <section className="activity-ledger"><header><span>VERIFIED CONTRACT ACTIVITY</span><span>{visibleEvents.length} VERIFIED EVENTS</span></header>{visibleEvents.map((event, index) => { const copy = COPY[event.kind]; const archived = event.provenance === "verified_archive"; return <a className="ledger-row" href={`${EXPLORER_URL}/tx/${event.txHash}`} target="_blank" rel="noreferrer" key={event.id}><span className="ledger-index">{String(index + 1).padStart(2, "0")}</span><span className="event-kind">{copy.label}{archived && <small>PROVEN</small>}</span><span className="event-copy"><strong>{event.actor || "Contract"}</strong><small>{copy.verb}{event.grantId === undefined ? event.category ? ` · ${event.category}` : "" : ` · Grant #${event.grantId}`}{event.amount ? ` · ${event.amount.toLocaleString()} XLM` : ""}</small></span><time>{new Date(event.closedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC</time><span className="event-link">↗</span></a>; })}</section>
    </div>
  );
}
