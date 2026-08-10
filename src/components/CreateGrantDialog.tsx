import { useMemo, useState } from "react";
import { CATEGORIES, validateGrant, type CreateGrantInput } from "../domain/grants";
import { createGrant } from "../lib/grant-client";
import type { MutationRunner } from "../App";

function defaultDeadline() {
  const value = new Date(Date.now() + 14 * 86_400_000);
  return value.toISOString().slice(0, 16);
}

const INITIAL: CreateGrantInput = {
  category: "Payments",
  title: "",
  description: "",
  goal: 1000,
  deadline: defaultDeadline(),
  milestones: [
    { title: "Prototype and contributor review", amount: 400 },
    { title: "Public launch and documentation", amount: 600 },
  ],
  approvalBps: 6000,
  quorumBps: 5000,
};

export function CreateGrantDialog({
  open,
  initialCategory,
  onClose,
  runMutation,
}: {
  open: boolean;
  initialCategory?: string;
  onClose: () => void;
  runMutation: MutationRunner;
}) {
  const [input, setInput] = useState<CreateGrantInput>(() => ({
    ...INITIAL,
    category: CATEGORIES.find((category) => category === initialCategory) ?? INITIAL.category,
  }));
  const [reviewing, setReviewing] = useState(false);
  const errors = useMemo(() => validateGrant(input), [input]);
  const total = input.milestones.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  if (!open) return null;

  function updateMilestone(index: number, patch: Partial<CreateGrantInput["milestones"][number]>) {
    setInput((current) => ({
      ...current,
      milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  async function submit() {
    if (errors.length) return;
    const success = await runMutation("Create grant", (context) => createGrant(input, context));
    if (success) onClose();
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-grant-title">
        <header><div><span>{reviewing ? "STEP 02 · REVIEW" : "STEP 01 · DESIGN"}</span><h2 id="create-grant-title">Create a community grant</h2></div><button type="button" onClick={onClose} aria-label="Close create grant">×</button></header>
        {!reviewing ? (
          <form onSubmit={(event) => { event.preventDefault(); if (!errors.length) setReviewing(true); }}>
            <div className="form-grid">
              <label>Signals category<select value={input.category} onChange={(event) => setInput({ ...input, category: event.target.value as CreateGrantInput["category"] })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Funding goal (XLM)<input type="number" min="0.0000001" step="0.0000001" value={input.goal} onChange={(event) => setInput({ ...input, goal: Number(event.target.value) })} /></label>
              <label className="wide">Grant title<input value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} placeholder="What will this grant deliver?" /></label>
              <label className="wide">Purpose<textarea value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} placeholder="Describe the outcome, beneficiaries, and proof of delivery." /></label>
              <label>Funding deadline<input type="datetime-local" value={input.deadline} onChange={(event) => setInput({ ...input, deadline: event.target.value })} /></label>
              <label>Approval threshold<input type="number" min="50" max="100" value={input.approvalBps / 100} onChange={(event) => setInput({ ...input, approvalBps: Number(event.target.value) * 100 })} /><small>percent of participating weight</small></label>
              <label>Quorum threshold<input type="number" min="10" max="100" value={input.quorumBps / 100} onChange={(event) => setInput({ ...input, quorumBps: Number(event.target.value) * 100 })} /><small>percent of contributed weight</small></label>
            </div>
            <div className="milestone-builder">
              <div><h3>Milestone schedule</h3><span className={Math.abs(total - input.goal) < 0.0000001 ? "matches" : "mismatch"}>{total.toLocaleString()} / {input.goal.toLocaleString()} XLM</span></div>
              {input.milestones.map((milestone, index) => <div className="milestone-input" key={index}><span>0{index + 1}</span><label>Milestone title<input value={milestone.title} onChange={(event) => updateMilestone(index, { title: event.target.value })} /></label><label>Amount<input type="number" min="0" step="0.0000001" value={milestone.amount} onChange={(event) => updateMilestone(index, { amount: Number(event.target.value) })} /></label>{input.milestones.length > 2 && <button type="button" onClick={() => setInput({ ...input, milestones: input.milestones.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove milestone ${index + 1}`}>×</button>}</div>)}
              {input.milestones.length < 5 && <button className="secondary-action" type="button" onClick={() => setInput({ ...input, milestones: [...input.milestones, { title: "", amount: 0 }] })}>+ Add milestone</button>}
            </div>
            {errors.length > 0 && <ul className="validation-list" aria-label="Grant validation errors">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <footer><button type="button" className="text-action" onClick={onClose}>Cancel</button><button className="primary-action compact" type="submit" disabled={errors.length > 0}>Review grant <span>→</span></button></footer>
          </form>
        ) : (
          <div className="grant-review">
            <span className="category-chip">{input.category}</span><h3>{input.title}</h3><p>{input.description}</p>
            <dl><div><dt>Goal</dt><dd>{input.goal.toLocaleString()} XLM</dd></div><div><dt>Deadline</dt><dd>{new Date(input.deadline).toLocaleString()}</dd></div><div><dt>Approval</dt><dd>{input.approvalBps / 100}%</dd></div><div><dt>Quorum</dt><dd>{input.quorumBps / 100}%</dd></div></dl>
            <ol>{input.milestones.map((milestone) => <li key={milestone.title}><span>{milestone.title}</span><strong>{milestone.amount.toLocaleString()} XLM</strong></li>)}</ol>
            <div className="review-warning"><strong>Wallet signature required</strong><span>The contract validates the category, exact milestone total, future deadline, and thresholds before opening an escrow vault.</span></div>
            <footer><button type="button" className="text-action" onClick={() => setReviewing(false)}>← Edit details</button><button className="primary-action compact" type="button" onClick={() => void submit()}>Create on Testnet <span>↗</span></button></footer>
          </div>
        )}
      </section>
    </div>
  );
}

