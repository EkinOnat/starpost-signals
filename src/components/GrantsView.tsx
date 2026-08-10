import { useMemo, useState } from "react";
import { EXPLORER_URL, GRANTS_ENABLED, REGISTRY_CONTRACT_ID } from "../config";
import { CATEGORIES, type GrantCategory, type GrantView } from "../domain/grants";
import {
  cancelGrant,
  claimRefund,
  contributeToGrant,
  finalizeFunding,
  finalizeMilestone,
  voteMilestone,
} from "../lib/grant-client";
import type { MutationRunner } from "../App";
import { CreateGrantDialog } from "./CreateGrantDialog";

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 7)}...${value.slice(-5)}` : value;
}
function daysRemaining(deadline: string) {
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  return days > 0 ? `${days} days left` : "Funding ended";
}

function statusLabel(status: GrantView["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function GrantsView({
  grants,
  address,
  initialCategory,
  runMutation,
}: {
  grants: GrantView[];
  address: string | null;
  initialCategory?: string;
  runMutation: MutationRunner;
}) {
  const [category, setCategory] = useState<GrantCategory | "All">(
    CATEGORIES.find((item) => item === initialCategory) ?? "All",
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [contribution, setContribution] = useState("25");
  const selected = grants.find((grant) => grant.id === selectedId) ?? null;
  const visible = category === "All" ? grants : grants.filter((grant) => grant.category === category);
  const summary = useMemo(() => ({
    raised: grants.reduce((sum, grant) => sum + grant.raised, 0),
    active: grants.filter((grant) => grant.status === "active" || grant.status === "funding").length,
    released: grants.reduce((sum, grant) => sum + grant.milestones.filter((milestone) => milestone.status === "released").length, 0),
  }), [grants]);

  if (selected) {
    const progress = selected.goal ? Math.min(100, Math.round((selected.raised / selected.goal) * 100)) : 0;
    const current = selected.milestones[selected.currentMilestone];
    const canRefund = selected.status === "failed" || selected.status === "cancelled";
    return (
      <div className="view grant-detail-view">
        <button type="button" className="back-action" onClick={() => setSelectedId(null)}>← Back to grants</button>
        <section className="grant-detail-hero">
          <div><div className="detail-meta"><span className="category-chip">{selected.category}</span><span className={`status-chip status-${selected.status}`}>{statusLabel(selected.status)}</span>{selected.demo && <span className="preview-chip">PREVIEW DATA</span>}</div><h1>{selected.title}</h1><p>{selected.description}</p><div className="creator-line"><span>CREATED BY</span><strong>{short(selected.creator)}</strong></div></div>
          <aside className="funding-card"><div><span>COMMUNITY ESCROW</span><strong>{selected.raised.toLocaleString()} <small>/ {selected.goal.toLocaleString()} XLM</small></strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="funding-facts"><span><small>FUNDED</small><strong>{progress}%</strong></span><span><small>DEADLINE</small><strong>{daysRemaining(selected.deadline)}</strong></span></div>{selected.status === "funding" && <form onSubmit={(event) => { event.preventDefault(); const amount = Number(contribution); if (amount > 0) void runMutation("Contribute XLM", (context) => contributeToGrant(selected.id, amount, context)); }}><label htmlFor="contribution">Contribution (XLM)</label><div><input id="contribution" type="number" min="0.0000001" step="0.0000001" value={contribution} onChange={(event) => setContribution(event.target.value)} /><button className="primary-action compact" type="submit">Fund grant ↗</button></div><small>Voting power equals your recorded contribution.</small></form>}</aside>
        </section>

        <section className="grant-detail-grid">
          <article className="milestone-timeline"><div className="section-heading"><div><span>VERIFIABLE DELIVERY</span><h2>Milestone timeline</h2></div><span>{selected.milestones.filter((item) => item.status === "released").length} / {selected.milestones.length} released</span></div>
            {selected.milestones.length ? selected.milestones.map((milestone) => {
              const participation = milestone.yesWeight + milestone.noWeight;
              const yes = participation ? Math.round((milestone.yesWeight / participation) * 100) : 0;
              return <div className={`milestone-row milestone-${milestone.status}`} key={milestone.index}><div className="milestone-marker"><span>{milestone.status === "released" ? "✓" : String(milestone.index + 1).padStart(2, "0")}</span><i /></div><div className="milestone-copy"><div><span>{milestone.status.toUpperCase()}</span><strong>{milestone.title}</strong></div><b>{milestone.amount.toLocaleString()} XLM</b>{milestone.status === "voting" && <div className="vote-meter"><div><i style={{ width: `${yes}%` }} /></div><span>{yes}% YES · {participation.toLocaleString()} WEIGHT</span></div>}</div></div>;
            }) : <div className="empty-state"><strong>Milestones are synchronizing</strong><p>The event snapshot is available; direct contract reads will fill the schedule after deployment.</p></div>}
          </article>

          <aside className="decision-card"><span className="panel-kicker">CURRENT DECISION</span>{selected.status === "active" && current ? <><span className="decision-number">MILESTONE {String(current.index + 1).padStart(2, "0")}</span><h2>{current.title}</h2><p>Contributors vote with the exact weight of their escrowed XLM. One vote per account, per milestone.</p><div className="threshold-grid"><span><small>APPROVAL</small><strong>{selected.approvalBps / 100}%</strong></span><span><small>QUORUM</small><strong>{selected.quorumBps / 100}%</strong></span></div><div className="vote-actions"><button type="button" onClick={() => void runMutation("Approve milestone", (context) => voteMilestone(selected.id, true, context))}>Vote yes <span>✓</span></button><button type="button" onClick={() => void runMutation("Reject milestone", (context) => voteMilestone(selected.id, false, context))}>Vote no <span>×</span></button></div><button className="primary-action compact" type="button" onClick={() => void runMutation("Release milestone", (context) => finalizeMilestone(selected.id, context))}>Finalize & release <span>↗</span></button></> : <><h2>{selected.status === "completed" ? "Delivery complete" : selected.status === "funding" ? "Funding in progress" : "Round closed"}</h2><p>{selected.status === "completed" ? "Every approved milestone was released through escrow." : selected.status === "funding" ? "The round can finalize at the exact goal or after its deadline." : "Contributors can recover eligible funds from escrow."}</p></>}
            <div className="utility-actions">{selected.status === "funding" && <button type="button" onClick={() => void runMutation("Finalize funding", (context) => finalizeFunding(selected.id, context))}>Finalize funding round</button>}{selected.status === "funding" && address && <button type="button" onClick={() => void runMutation("Cancel grant", (context) => cancelGrant(selected.id, context))}>Cancel as creator</button>}{canRefund && <button type="button" onClick={() => void runMutation("Claim refund", (context) => claimRefund(selected.id, context))}>Claim escrow refund</button>}</div>
            {GRANTS_ENABLED && <a className="contract-link" href={`${EXPLORER_URL}/contract/${REGISTRY_CONTRACT_ID}`} target="_blank" rel="noreferrer">Registry contract ↗</a>}
          </aside>
        </section>
      </div>
    );
  }

  return (
    <div className="view grants-view">
      <section className="grants-hero"><div><span className="eyebrow"><i>02</i> FUND THE WORK</span><h1>Move the strongest<br /><em>signals into motion.</em></h1></div><div><p>Community-backed projects are funded in Testnet XLM, released milestone by milestone, and verified through contract events.</p><button className="primary-action compact" type="button" onClick={() => setShowCreate(true)}>Create a grant <span>↗</span></button></div></section>
      {!GRANTS_ENABLED && <div className="preview-banner"><span>PREVIEW MODE</span><p>Discovery is populated with representative data. Wallet actions activate when the new Testnet Registry and Escrow IDs are configured.</p></div>}
      <section className="grant-summary"><div><span>TOTAL RAISED</span><strong>{summary.raised.toLocaleString()} <small>XLM</small></strong></div><div><span>ACTIVE GRANTS</span><strong>{String(summary.active).padStart(2, "0")}</strong></div><div><span>MILESTONES RELEASED</span><strong>{String(summary.released).padStart(2, "0")}</strong></div></section>
      <section className="discovery-section"><div className="discovery-toolbar"><div><span>DISCOVER BY SIGNAL</span><h2>Community grants</h2></div><div className="category-filters" role="group" aria-label="Filter grants by category">{(["All", ...CATEGORIES] as const).map((item) => <button type="button" className={category === item ? "active" : ""} aria-pressed={category === item} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div></div>
        {visible.length ? <div className="grant-grid">{visible.map((grant) => { const progress = grant.goal ? Math.min(100, Math.round((grant.raised / grant.goal) * 100)) : 0; const next = grant.milestones[grant.currentMilestone]; return <button type="button" className="grant-card" onClick={() => setSelectedId(grant.id)} key={grant.id}><div className="grant-card-top"><span className="category-chip">{grant.category}</span><span className={`status-chip status-${grant.status}`}>{statusLabel(grant.status)}</span></div><h3>{grant.title}</h3><p>{grant.description}</p><div className="grant-progress"><div><span>{grant.raised.toLocaleString()} XLM raised</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div><div className="grant-next"><span><small>NEXT MILESTONE</small><strong>{next?.title ?? "All milestones delivered"}</strong></span><i>→</i></div><footer><span>{short(grant.creator)}</span><span>{daysRemaining(grant.deadline)}</span></footer></button>; })}</div> : <div className="empty-state large"><strong>No grants in this orbit yet</strong><p>Be the first to turn the selected signal into milestone-based work.</p><button className="secondary-action" type="button" onClick={() => setShowCreate(true)}>Create a {category} grant</button></div>}
      </section>
      <CreateGrantDialog open={showCreate} initialCategory={category === "All" ? initialCategory : category} onClose={() => setShowCreate(false)} runMutation={runMutation} />
    </div>
  );
}
