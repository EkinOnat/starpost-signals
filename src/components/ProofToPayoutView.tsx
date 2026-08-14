import { useCallback, useEffect, useMemo, useState } from "react";
import type { MutationRunner } from "../App";
import {
  EVIDENCE_API_URL,
  EXPLORER_URL,
  IMPACT_ENABLED,
  IMPACT_REGISTRY_CONTRACT_ID,
  INDEXER_URL,
} from "../config";
import {
  formatAtomicAmount,
  shortAddress,
  type EvidenceStage,
  type ImpactMilestoneView,
  type ImpactProjectView,
} from "../domain/impact";
import { uploadEvidence, validateEvidenceFile, type EvidenceReceipt } from "../lib/evidence-client";
import {
  acceptImpactRole,
  activateImpactProject,
  applyImpactTimeout,
  arbitrateImpact,
  attestImpact,
  cancelImpactProject,
  claimImpactRefund,
  contributeImpact,
  finalizeImpactDispute,
  finalizeImpactFunding,
  finalizeImpactReview,
  finalizeImpactVote,
  openImpactFunding,
  openImpactReview,
  openImpactVoting,
  readImpactProjects,
  releaseImpactMilestone,
  startImpactRework,
  submitImpactEvidence,
  voteImpact,
} from "../lib/impact-client";
import { CreateImpactProjectDialog } from "./CreateImpactProjectDialog";
import { trackProductEvent } from "../lib/telemetry";

type LoadState = "idle" | "loading" | "ready" | "failed";
type AuditEvent = { id: string; topic: string; txHash: string; ledger: number; closedAt: string };

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(seconds: number) {
  return seconds > 0 ? new Date(seconds * 1_000).toLocaleString() : "Not started";
}

function ProjectActions({
  project,
  address,
  runMutation,
  refresh,
}: {
  project: ImpactProjectView;
  address: string | null;
  runMutation: MutationRunner;
  refresh: () => void;
}) {
  const [amount, setAmount] = useState("10");
  const [file, setFile] = useState<File | null>(null);
  const [evidenceStage, setEvidenceStage] = useState<EvidenceStage>("idle");
  const [receipt, setReceipt] = useState<EvidenceReceipt | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const milestone = project.milestones[project.currentMilestone];
  const isCreator = address === project.creator;
  const isReviewer = Boolean(address && project.reviewers.includes(address));
  const isArbitrator = Boolean(address && project.arbitrators.includes(address));

  async function mutate(label: string, action: Parameters<MutationRunner>[1]) {
    if (await runMutation(label, action)) refresh();
  }

  async function storeEvidence() {
    if (!file || !milestone) return;
    const validation = validateEvidenceFile(file);
    if (validation.length) {
      setFileError(validation[0]);
      setEvidenceStage("failed");
      return;
    }
    setFileError(null);
    trackProductEvent("evidence_submission_started");
    try {
      const stored = await uploadEvidence(file, {
        projectId: project.id,
        milestone: milestone.index,
        attempt: milestone.attempt,
      }, (progress) => setEvidenceStage(progress.stage));
      setReceipt(stored);
    } catch (cause) {
      setEvidenceStage("failed");
      setFileError(cause instanceof Error ? cause.message : "Evidence upload failed.");
    }
  }

  async function anchorEvidence() {
    if (!receipt || !milestone) return;
    setEvidenceStage("anchoring_hash");
    const success = await runMutation("Anchor evidence hash", (context) => submitImpactEvidence(
      project.id,
      milestone.index,
      milestone.attempt,
      receipt.contentHash,
      receipt.metadataHash,
      context,
    ));
    setEvidenceStage(success ? "confirmed" : "stored");
    if (success) refresh();
  }

  if (!milestone && project.status === "active") {
    return <div className="empty-state"><strong>Milestone state unavailable</strong><p>Retry the direct contract read before signing an action.</p></div>;
  }

  return (
    <div className="impact-actions">
      <span className="panel-kicker">AVAILABLE ACTIONS</span>
      {!address && <p className="action-note">Connect a Testnet wallet when you are ready to sign. Project state remains public without a wallet.</p>}

      {project.status === "draft" && <>
        {isReviewer && <button type="button" onClick={() => void mutate("Accept reviewer assignment", (context) => acceptImpactRole(project.id, "reviewer", context))}>Accept reviewer assignment</button>}
        {isArbitrator && <button type="button" onClick={() => void mutate("Accept arbitrator assignment", (context) => acceptImpactRole(project.id, "arbitrator", context))}>Accept arbitrator assignment</button>}
        {isCreator && <button type="button" onClick={() => void mutate("Open project funding", (context) => openImpactFunding(project.id, context))}>Open funding after role acceptance</button>}
      </>}

      {project.status === "funding" && <>
        <form onSubmit={(event) => { event.preventDefault(); void mutate("Contribute Testnet XLM", (context) => contributeImpact(project.id, amount, context)); }}>
          <label htmlFor={`impact-contribution-${project.id}`}>Contribution (XLM)</label>
          <div><input id={`impact-contribution-${project.id}`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><button type="submit">Contribute</button></div>
        </form>
        <button type="button" onClick={() => void mutate("Finalize project funding", (context) => finalizeImpactFunding(project.id, context))}>Finalize funding at goal or deadline</button>
        {isCreator && <button className="danger-action" type="button" onClick={() => { if (window.confirm("Cancel this funding project and enable contributor refunds?")) void mutate("Cancel project", (context) => cancelImpactProject(project.id, context)); }}>Cancel and refund</button>}
      </>}

      {project.status === "funded" && <button type="button" onClick={() => void mutate("Activate project", (context) => activateImpactProject(project.id, context))}>Activate delivery</button>}

      {project.status === "active" && milestone?.status === "pending" && isCreator && <section className="evidence-uploader">
        <h3>Submit milestone evidence</h3>
        <p>Public files only. Never upload KYC, identity documents, secrets, or personal information.</p>
        <label>Evidence file<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReceipt(null); setEvidenceStage("idle"); }} /></label>
        {file && <small>{file.name} · {(file.size / 1_048_576).toFixed(2)} MB</small>}
        {fileError && <p role="alert" className="inline-error">{fileError}</p>}
        <div className="evidence-stages" aria-live="polite"><span>{statusLabel(evidenceStage)}</span>{receipt && <code>{receipt.contentHash.slice(0, 16)}…</code>}</div>
        {!receipt ? <button type="button" disabled={!file || ["hashing", "uploading"].includes(evidenceStage)} onClick={() => void storeEvidence()}>Hash and store file</button> : <button type="button" onClick={() => void anchorEvidence()}>Anchor stored hash on Testnet</button>}
      </section>}

      {project.status === "active" && milestone?.status === "evidence_submitted" && <button type="button" onClick={() => void mutate("Open evidence review", (context) => openImpactReview(project.id, milestone.index, context))}>Open independent review</button>}

      {project.status === "active" && milestone?.status === "under_review" && <>
        {isReviewer && milestone.evidenceContentHash && <div className="decision-buttons"><button type="button" onClick={() => void mutate("Verify milestone evidence", (context) => attestImpact(project.id, milestone.index, milestone.attempt, milestone.evidenceContentHash, "Verify", context))}>Verify evidence</button><button type="button" onClick={() => void mutate("Reject milestone evidence", (context) => attestImpact(project.id, milestone.index, milestone.attempt, milestone.evidenceContentHash, "Reject", context))}>Reject evidence</button></div>}
        <button type="button" onClick={() => void mutate("Finalize evidence review", (context) => finalizeImpactReview(project.id, milestone.index, context))}>Finalize review after deadline</button>
      </>}

      {project.status === "active" && milestone?.status === "verified" && <button type="button" onClick={() => void mutate("Open contributor voting", (context) => openImpactVoting(project.id, milestone.index, context))}>Open contributor voting</button>}

      {project.status === "active" && milestone?.status === "voting" && milestone.evidenceContentHash && <>
        <div className="decision-buttons"><button type="button" onClick={() => void mutate("Approve milestone", (context) => voteImpact(project.id, milestone.index, milestone.attempt, milestone.evidenceContentHash, "Approve", context))}>Approve payout</button><button type="button" onClick={() => void mutate("Dispute milestone", (context) => voteImpact(project.id, milestone.index, milestone.attempt, milestone.evidenceContentHash, "Dispute", context))}>Open dispute</button></div>
        <button type="button" onClick={() => void mutate("Finalize contributor vote", (context) => finalizeImpactVote(project.id, milestone.index, context))}>Finalize after voting deadline</button>
      </>}

      {project.status === "active" && milestone?.status === "approved" && <button type="button" onClick={() => void mutate("Release milestone payout", (context) => releaseImpactMilestone(project.id, milestone.index, context))}>Release exact milestone payout</button>}
      {project.status === "active" && milestone?.status === "rejected" && isCreator && <button type="button" onClick={() => void mutate("Start evidence rework", (context) => startImpactRework(project.id, milestone.index, context))}>Start final rework attempt</button>}

      {project.status === "disputed" && milestone && <>
        {isArbitrator && <div className="arbitration-actions"><button type="button" onClick={() => void mutate("Approve release in arbitration", (context) => arbitrateImpact(project.id, milestone.index, milestone.attempt, "ApproveRelease", context))}>Arbitrate: release</button><button type="button" onClick={() => void mutate("Require evidence rework", (context) => arbitrateImpact(project.id, milestone.index, milestone.attempt, "RequireRework", context))}>Arbitrate: rework</button><button type="button" onClick={() => void mutate("Reject milestone in arbitration", (context) => arbitrateImpact(project.id, milestone.index, milestone.attempt, "RejectMilestone", context))}>Arbitrate: reject</button></div>}
        <button type="button" onClick={() => void mutate("Finalize milestone dispute", (context) => finalizeImpactDispute(project.id, milestone.index, context))}>Finalize arbitration threshold or timeout</button>
      </>}

      {(["active", "disputed"] as const).includes(project.status as "active" | "disputed") && <button className="text-action" type="button" onClick={() => void mutate("Apply project deadline", (context) => applyImpactTimeout(project.id, context))}>Apply an expired stage deadline</button>}
      {project.refundable && <button type="button" onClick={() => void mutate("Claim project refund", (context) => claimImpactRefund(project.id, context))}>Claim proportional escrow refund</button>}
    </div>
  );
}

function ProjectDetail({ project, address, runMutation, onBack, refresh }: { project: ImpactProjectView; address: string | null; runMutation: MutationRunner; onBack: () => void; refresh: () => void }) {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditUnavailable, setAuditUnavailable] = useState(false);
  useEffect(() => {
    if (!INDEXER_URL) { setAuditUnavailable(true); return; }
    let active = true;
    void fetch(`${INDEXER_URL}/api/v1/contract-events?projectId=${project.id}&limit=100`)
      .then((response) => {
        if (!response.ok) throw new Error("audit_unavailable");
        return response.json() as Promise<{ events: AuditEvent[] }>;
      })
      .then((result) => { if (active) setAuditEvents(result.events); })
      .catch(() => { if (active) setAuditUnavailable(true); });
    return () => { active = false; };
  }, [project.id]);
  const progress = BigInt(project.goalAtomic) > 0n
    ? Number((BigInt(project.depositedAtomic) * 100n) / BigInt(project.goalAtomic))
    : 0;
  return <div className="impact-detail">
    <button className="back-action" type="button" onClick={onBack}>← All proof projects</button>
    <section className="impact-detail-hero">
      <div><div className="detail-meta"><span className="category-chip">{project.category}</span><span className={`status-chip status-${project.status}`}>{statusLabel(project.status)}</span></div><h1>{project.title}</h1><p>{project.description}</p><div className="creator-line"><span>CREATOR</span><strong>{shortAddress(project.creator)}</strong><span>PAYOUT</span><strong>{shortAddress(project.payout)}</strong></div></div>
      <aside className="impact-funding-card"><span>CONTRACT ESCROW</span><strong>{formatAtomicAmount(project.depositedAtomic, project.assetDecimals)} <small>/ {formatAtomicAmount(project.goalAtomic, project.assetDecimals)} {project.assetCode}</small></strong><div className="progress-track"><i style={{ width: `${Math.min(100, progress)}%` }} /></div><dl><div><dt>CONTRIBUTORS</dt><dd>{project.contributorCount}</dd></div><div><dt>RELEASED</dt><dd>{formatAtomicAmount(project.releasedAtomic, project.assetDecimals)} {project.assetCode}</dd></div><div><dt>FUNDING DEADLINE</dt><dd>{dateTime(project.fundingDeadline)}</dd></div></dl></aside>
    </section>
    <section className="impact-detail-grid">
      <article className="impact-timeline"><div className="section-heading"><div><span>PROVE → APPROVE → PAYOUT</span><h2>Verifiable milestones</h2></div><span>{project.milestones.filter((item) => item.status === "released").length} / {project.milestones.length} released</span></div>
        {project.milestones.map((milestone) => <div className={`impact-milestone milestone-${milestone.status}`} key={milestone.index}><div className="milestone-marker"><span>{milestone.status === "released" ? "✓" : String(milestone.index + 1).padStart(2, "0")}</span><i /></div><div><header><span>{statusLabel(milestone.status)} · attempt {milestone.attempt}</span><strong>{milestone.title}</strong><b>{formatAtomicAmount(milestone.amountAtomic, project.assetDecimals)} {project.assetCode}</b></header><p>{milestone.description}</p>{milestone.evidenceContentHash && <div className="evidence-proof"><span>SHA-256</span><code>{milestone.evidenceContentHash}</code>{EVIDENCE_API_URL && <a href={`${EVIDENCE_API_URL}/api/v1/evidence/${milestone.evidenceContentHash}`} target="_blank" rel="noreferrer">Download and verify ↗</a>}</div>}<footer><span>Reviews {milestone.verifyCount} verify / {milestone.rejectCount} reject</span><span>Voting ends {dateTime(milestone.votingDeadline)}</span></footer></div></div>)}
      </article>
      <aside className="impact-decision"><ProjectActions project={project} address={address} runMutation={runMutation} refresh={refresh} /><div className="authority-note"><strong>Financial authority</strong><p>Registry rules authorize decisions; Escrow V1 alone holds and transfers assets. Indexed data and this interface cannot release funds.</p><a href={`${EXPLORER_URL}/contract/${IMPACT_REGISTRY_CONTRACT_ID}`} target="_blank" rel="noreferrer">Inspect Registry on Stellar Expert ↗</a></div></aside>
    </section>
    <section className="impact-audit"><header><div><span>PUBLIC AUDIT TRAIL</span><h2>Versioned contract events</h2></div><strong>{auditEvents.length} indexed</strong></header>{auditEvents.length > 0 ? <ol>{auditEvents.map((event) => <li key={event.id}><span>{event.topic.replaceAll("_", " ")}</span><strong>Ledger {event.ledger.toLocaleString()}</strong><time>{new Date(event.closedAt).toLocaleString()}</time><a href={`${EXPLORER_URL}/tx/${event.txHash}`} target="_blank" rel="noreferrer" aria-label={`Open ${event.topic} transaction`}>↗</a></li>)}</ol> : <div className="empty-state"><strong>{auditUnavailable ? "Indexed history is unavailable" : "Waiting for indexed events"}</strong><p>Direct contract state above remains authoritative. The audit service cannot authorize or hide a payout.</p></div>}</section>
  </div>;
}

export function ProofToPayoutView({ address, runMutation }: { address: string | null; runMutation: MutationRunner }) {
  const [projects, setProjects] = useState<ImpactProjectView[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [showCreate, setShowCreate] = useState(false);
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!IMPACT_ENABLED) return;
    setLoadState("loading");
    try {
      setProjects(await readImpactProjects());
      setLoadState("ready");
    } catch {
      setLoadState("failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const summary = useMemo(() => ({
    active: projects.filter((project) => ["funding", "funded", "active", "disputed"].includes(project.status)).length,
    paid: projects.reduce((total, project) => total + BigInt(project.releasedAtomic), 0n),
    evidence: projects.reduce((total, project) => total + project.milestones.filter((milestone) => milestone.evidenceContentHash).length, 0),
  }), [projects]);

  if (selected) return <ProjectDetail project={selected} address={address} runMutation={runMutation} onBack={() => setSelectedId(null)} refresh={() => void load()} />;

  return <div className="view impact-view">
    <section className="impact-hero"><div><span className="eyebrow"><i>03</i> PROOF TO PAYOUT</span><h1>Fund the work.<br /><em>Verify the outcome.</em></h1></div><div><p>Independent reviewers verify content-addressed evidence, contributors approve or dispute delivery, and Soroban escrow releases only the exact authorized milestone.</p><button className="primary-action compact" type="button" disabled={!IMPACT_ENABLED} onClick={() => setShowCreate(true)}>Create proof project <span>↗</span></button></div></section>
    {!IMPACT_ENABLED && <div className="deployment-banner" role="status"><strong>Level 4 contracts are not configured</strong><p>The implementation is ready for a versioned Testnet deployment. No preview projects or simulated payouts are shown. Add both V1 contract IDs to enable public reads and wallet actions.</p></div>}
    {IMPACT_ENABLED && <>
      <section className="impact-summary"><div><span>ACTIVE PROJECTS</span><strong>{String(summary.active).padStart(2, "0")}</strong></div><div><span>EVIDENCE COMMITMENTS</span><strong>{String(summary.evidence).padStart(2, "0")}</strong></div><div><span>TOTAL RELEASED</span><strong>{formatAtomicAmount(summary.paid, 7)} <small>XLM</small></strong></div></section>
      <section className="impact-discovery"><header><div><span>PUBLIC CONTRACT STATE</span><h2>Proof-based projects</h2></div><button type="button" className="secondary-action" onClick={() => void load()} disabled={loadState === "loading"}>{loadState === "loading" ? "Reading contracts…" : "Refresh"}</button></header>
        {loadState === "loading" && !projects.length && <div className="project-skeletons" aria-label="Loading projects"><i /><i /><i /></div>}
        {loadState === "failed" && <div className="empty-state large"><strong>Contract reads are unavailable</strong><p>No financial state was inferred from the indexer. Check the Testnet RPC connection and retry.</p><button className="secondary-action" type="button" onClick={() => void load()}>Retry direct reads</button></div>}
        {loadState === "ready" && !projects.length && <div className="empty-state large"><strong>No proof projects yet</strong><p>Create the first project after the V1 Registry and Escrow are initialized.</p><button className="secondary-action" type="button" onClick={() => setShowCreate(true)}>Create project</button></div>}
        {projects.length > 0 && <div className="impact-project-grid">{projects.map((project) => { const milestone = project.milestones[project.currentMilestone]; return <button className="impact-project-card" type="button" onClick={() => { trackProductEvent("project_viewed"); setSelectedId(project.id); }} key={project.id}><header><span className="category-chip">{project.category}</span><span className={`status-chip status-${project.status}`}>{statusLabel(project.status)}</span></header><h3>{project.title}</h3><p>{project.description}</p><div className="project-proof-line"><span>CURRENT PROOF</span><strong>{milestone ? `${milestone.title} · ${statusLabel(milestone.status)}` : "Lifecycle complete"}</strong></div><footer><span>{formatAtomicAmount(project.depositedAtomic, project.assetDecimals)} / {formatAtomicAmount(project.goalAtomic, project.assetDecimals)} {project.assetCode}</span><span>#{project.id} →</span></footer></button>; })}</div>}
      </section>
    </>}
    <CreateImpactProjectDialog open={showCreate} address={address} onClose={() => setShowCreate(false)} onCreated={() => void load()} runMutation={runMutation} />
  </div>;
}
