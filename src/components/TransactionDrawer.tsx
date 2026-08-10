import { EXPLORER_URL } from "../config";
import type { TransactionState, TransactionStage } from "../types";

const STEPS: Array<{ stage: TransactionStage; label: string }> = [
  { stage: "validating", label: "Validate" },
  { stage: "simulating", label: "Simulate" },
  { stage: "awaiting_signature", label: "Sign" },
  { stage: "submitted", label: "Submit" },
  { stage: "pending", label: "Confirm" },
];

const ORDER: TransactionStage[] = [
  "idle",
  "validating",
  "simulating",
  "awaiting_signature",
  "submitted",
  "pending",
  "success",
  "failed",
];

export function TransactionDrawer({
  transaction,
  onDismiss,
}: {
  transaction: TransactionState;
  onDismiss: () => void;
}) {
  if (transaction.stage === "idle") return null;
  const current = ORDER.indexOf(transaction.stage);
  const pendingTimeout = transaction.error?.code === "PENDING_TIMEOUT";
  return (
    <aside className={`transaction-drawer is-${transaction.stage}`} aria-live="polite" aria-label="Latest transaction">
      <div className="transaction-topline">
        <span className="pulse-dot" />
        <div>
          <small>LATEST TRANSACTION</small>
          <strong>{transaction.label}</strong>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss transaction status">×</button>
      </div>
      <div className="transaction-track">
        {STEPS.map((step, index) => (
          <span
            key={step.stage}
            className={current >= index + 1 && transaction.stage !== "failed" ? "is-complete" : ""}
          >
            <i>{current > index + 1 || transaction.stage === "success" ? "✓" : index + 1}</i>
            {step.label}
          </span>
        ))}
      </div>
      {transaction.error && (
        <div className={pendingTimeout ? "transaction-neutral" : "transaction-error"} role="alert">
          <strong>{transaction.error.title}</strong>
          <p>{transaction.error.message}</p>
        </div>
      )}
      {transaction.stage === "success" && (
        <p className="transaction-success">Confirmed by Stellar RPC. Contract state is syncing now.</p>
      )}
      {transaction.hash && (
        <a href={`${EXPLORER_URL}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">
          Check transaction on Explorer ↗
        </a>
      )}
    </aside>
  );
}

