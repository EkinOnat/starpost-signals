import { useMemo, useState } from "react";
import type { MutationRunner } from "../App";
import {
  IMPACT_CATEGORIES,
  formatAtomicAmount,
  parseAtomicAmount,
  validateProjectDraft,
  type ProjectDraftInput,
} from "../domain/impact";
import { createImpactProject } from "../lib/impact-client";

function defaultDeadline() {
  return new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16);
}

const EMPTY_ADDRESSES = ["", "", ""];
const INITIAL: ProjectDraftInput = {
  category: "Payments",
  title: "",
  description: "",
  payout: "",
  goal: "100",
  fundingDeadline: defaultDeadline(),
  reviewers: EMPTY_ADDRESSES,
  arbitrators: EMPTY_ADDRESSES,
  milestones: [
    { title: "First verified delivery", description: "", amount: "40", deliveryDays: 14 },
    { title: "Final verified delivery", description: "", amount: "60", deliveryDays: 14 },
  ],
};

export function CreateImpactProjectDialog({
  open,
  address,
  onClose,
  onCreated,
  runMutation,
}: {
  open: boolean;
  address: string | null;
  onClose: () => void;
  onCreated: () => void;
  runMutation: MutationRunner;
}) {
  const [input, setInput] = useState<ProjectDraftInput>(() => ({
    ...INITIAL,
    payout: address ?? "",
    reviewers: [...EMPTY_ADDRESSES],
    arbitrators: [...EMPTY_ADDRESSES],
    milestones: INITIAL.milestones.map((milestone) => ({ ...milestone })),
  }));
  const [reviewing, setReviewing] = useState(false);
  const errors = useMemo(() => validateProjectDraft(input), [input]);
  const milestoneTotal = useMemo(() => {
    try {
      return input.milestones.reduce((sum, milestone) => sum + parseAtomicAmount(milestone.amount, 7), 0n);
    } catch {
      return 0n;
    }
  }, [input.milestones]);

  if (!open) return null;

  function updateRole(role: "reviewers" | "arbitrators", index: number, value: string) {
    setInput((current) => ({
      ...current,
      [role]: current[role].map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  }

  function updateMilestone(index: number, patch: Partial<ProjectDraftInput["milestones"][number]>) {
    setInput((current) => ({
      ...current,
      milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  async function submit() {
    if (errors.length) return;
    const success = await runMutation("Create proof project", (context) => createImpactProject(input, context));
    if (success) {
      onCreated();
      onClose();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="create-dialog impact-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-impact-title">
        <header>
          <div><span>{reviewing ? "STEP 02 · VERIFY" : "STEP 01 · DESIGN"}</span><h2 id="create-impact-title">Create a proof-to-payout project</h2></div>
          <button type="button" onClick={onClose} aria-label="Close create project">×</button>
        </header>
        {!reviewing ? (
          <form onSubmit={(event) => { event.preventDefault(); if (!errors.length) setReviewing(true); }}>
            <div className="form-grid">
              <label>Signal category<select value={input.category} onChange={(event) => setInput({ ...input, category: event.target.value as ProjectDraftInput["category"] })}>{IMPACT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Funding goal (XLM)<input inputMode="decimal" value={input.goal} onChange={(event) => setInput({ ...input, goal: event.target.value })} /></label>
              <label className="wide">Project title<input value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} placeholder="A measurable outcome" /></label>
              <label className="wide">Public description<textarea value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} placeholder="Explain the need, delivery, and proof. Do not include personal or KYC data." /></label>
              <label>Funding deadline<input type="datetime-local" value={input.fundingDeadline} onChange={(event) => setInput({ ...input, fundingDeadline: event.target.value })} /></label>
              <label>Payout address<input value={input.payout} onChange={(event) => setInput({ ...input, payout: event.target.value.trim() })} placeholder="G…" /></label>
            </div>

            <fieldset className="role-builder"><legend>Independent roles</legend><p>All six accounts must be unique and cannot be the payout account.</p>
              <div className="form-grid">
                {input.reviewers.map((value, index) => <label key={`reviewer-${index}`}>Reviewer {index + 1}<input value={value} onChange={(event) => updateRole("reviewers", index, event.target.value.trim())} placeholder="G…" /></label>)}
                {input.arbitrators.map((value, index) => <label key={`arbitrator-${index}`}>Arbitrator {index + 1}<input value={value} onChange={(event) => updateRole("arbitrators", index, event.target.value.trim())} placeholder="G…" /></label>)}
              </div>
            </fieldset>

            <div className="milestone-builder">
              <div><h3>Measurable milestones</h3><span className={formatAtomicAmount(milestoneTotal, 7) === input.goal ? "matches" : "mismatch"}>{formatAtomicAmount(milestoneTotal, 7)} / {input.goal} XLM</span></div>
              {input.milestones.map((milestone, index) => <div className="impact-milestone-input" key={index}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <label>Title<input value={milestone.title} onChange={(event) => updateMilestone(index, { title: event.target.value })} /></label>
                <label>Proof criteria<textarea value={milestone.description} onChange={(event) => updateMilestone(index, { description: event.target.value })} /></label>
                <label>Amount<input inputMode="decimal" value={milestone.amount} onChange={(event) => updateMilestone(index, { amount: event.target.value })} /></label>
                <label>Delivery days<input type="number" min="1" max="365" value={milestone.deliveryDays} onChange={(event) => updateMilestone(index, { deliveryDays: Number(event.target.value) })} /></label>
                {input.milestones.length > 2 && <button type="button" onClick={() => setInput({ ...input, milestones: input.milestones.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove milestone ${index + 1}`}>Remove</button>}
              </div>)}
              {input.milestones.length < 5 && <button className="secondary-action" type="button" onClick={() => setInput({ ...input, milestones: [...input.milestones, { title: "", description: "", amount: "0", deliveryDays: 14 }] })}>+ Add milestone</button>}
            </div>
            {errors.length > 0 && <ul className="validation-list" aria-label="Project validation errors">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <footer><button type="button" className="text-action" onClick={onClose}>Cancel</button><button className="primary-action compact" type="submit" disabled={errors.length > 0}>Review project <span>→</span></button></footer>
          </form>
        ) : (
          <div className="grant-review">
            <span className="category-chip">{input.category}</span><h3>{input.title}</h3><p>{input.description}</p>
            <dl><div><dt>GOAL</dt><dd>{input.goal} XLM</dd></div><div><dt>MILESTONES</dt><dd>{input.milestones.length}</dd></div><div><dt>REVIEWERS</dt><dd>2 of 3</dd></div><div><dt>ARBITRATORS</dt><dd>2 of 3</dd></div></dl>
            <ol>{input.milestones.map((milestone) => <li key={milestone.title}><span>{milestone.title}</span><strong>{milestone.amount} XLM</strong></li>)}</ol>
            <div className="review-warning"><strong>Public and immutable commitments</strong><span>Metadata is stored by content hash; project rules, role addresses, deadlines, and exact payouts are enforced by the versioned contracts. Do not submit private information.</span></div>
            <footer><button type="button" className="text-action" onClick={() => setReviewing(false)}>← Edit details</button><button className="primary-action compact" type="button" onClick={() => void submit()}>Create on Testnet <span>↗</span></button></footer>
          </div>
        )}
      </section>
    </div>
  );
}
