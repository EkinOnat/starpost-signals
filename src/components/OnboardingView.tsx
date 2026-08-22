import { useState } from "react";
import { EXPLORER_URL, FEEDBACK_FORM_URL } from "../config";
import {
  ONBOARDING_STEPS,
  ROLE_GUIDANCE,
  type OnboardingProgress,
  type OnboardingRole,
  type OnboardingStep,
} from "../domain/onboarding";
import { trackProductEvent } from "../lib/telemetry";
import type { TransactionState } from "../types";

type Destination = "signals" | "grants" | "proof";

type OnboardingViewProps = {
  progress: OnboardingProgress;
  address: string | null;
  walletName: string | null;
  balance: number | null;
  connecting: boolean;
  funding: boolean;
  transaction: TransactionState;
  onChooseRole: (role: OnboardingRole) => void;
  onMove: (current: OnboardingStep, next: OnboardingStep) => void;
  onBack: () => void;
  onRestart: () => void;
  onConnect: () => Promise<string | null>;
  onFund: () => Promise<void>;
  onNavigate: (destination: Destination) => void;
};

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Choose role",
  wallet: "Connect",
  testnet: "Get ready",
  action: "Take action",
  confirmation: "Keep proof",
  feedback: "Share feedback",
};

function StepRail({ current }: { current: OnboardingStep }) {
  const active = ONBOARDING_STEPS.indexOf(current);
  return (
    <ol className="onboarding-steps" aria-label="Onboarding progress">
      {ONBOARDING_STEPS.map((step, index) => (
        <li className={index < active ? "complete" : index === active ? "active" : ""} key={step} aria-current={step === current ? "step" : undefined}>
          <i>{index < active ? "✓" : String(index + 1).padStart(2, "0")}</i>
          <span>{STEP_LABELS[step]}</span>
        </li>
      ))}
    </ol>
  );
}

function WelcomeStep({ progress, onChooseRole, onContinue }: Pick<OnboardingViewProps, "progress" | "onChooseRole"> & { onContinue: () => void }) {
  return (
    <div className="onboarding-copy">
      <span className="eyebrow"><i>01</i> COMMUNITY ROLE</span>
      <h1>Choose how you want to help.</h1>
      <p>Starpost is a public Stellar Testnet exercise. Test assets have no value, wallet activity is visible on-chain, and support will never ask for a secret key or recovery phrase.</p>
      <div className="onboarding-role-grid" role="radiogroup" aria-label="Community role">
        {(Object.entries(ROLE_GUIDANCE) as [OnboardingRole, (typeof ROLE_GUIDANCE)[OnboardingRole]][]).map(([role, guidance]) => (
          <button type="button" role="radio" aria-checked={progress.role === role} className={progress.role === role ? "selected" : ""} onClick={() => onChooseRole(role)} key={role}>
            <small>{guidance.action}</small>
            <strong>{guidance.label}</strong>
            <span>{guidance.description}</span>
          </button>
        ))}
      </div>
      <div className="onboarding-actions">
        <button className="primary-action" type="button" disabled={!progress.role} onClick={onContinue}>Continue to wallet <span>→</span></button>
      </div>
    </div>
  );
}

function WalletStep({ address, walletName, connecting, onConnect, onContinue }: Pick<OnboardingViewProps, "address" | "walletName" | "connecting" | "onConnect"> & { onContinue: () => void }) {
  async function continueWithWallet() {
    const active = address ?? await onConnect();
    if (!active) return;
    trackProductEvent("onboarding_wallet_ready");
    onContinue();
  }
  return (
    <div className="onboarding-copy narrow">
      <span className="eyebrow"><i>02</i> WALLET</span>
      <h1>{address ? "Wallet connected." : "Bring your Testnet wallet."}</h1>
      <p>Use Freighter, xBull, Albedo, or LOBSTR. The wallet keeps custody and asks you to approve every on-chain action.</p>
      <div className={`readiness-card ${address ? "ready" : ""}`}>
        <span>{address ? "READY" : "NOT CONNECTED"}</span>
        <strong>{address ? `${walletName ?? "Wallet"} · ${address.slice(0, 8)}…${address.slice(-6)}` : "Choose a supported wallet"}</strong>
        <p>{address ? "The connection verified Stellar Testnet before continuing." : "Unlock the wallet and select Stellar Testnet before opening the picker."}</p>
      </div>
      <div className="onboarding-actions">
        <button className="primary-action" type="button" disabled={connecting} onClick={() => void continueWithWallet()}>{connecting ? "Opening wallet…" : address ? "Check Testnet balance" : "Connect wallet"}<span>→</span></button>
      </div>
    </div>
  );
}

function TestnetStep({ address, balance, funding, onFund, onContinue }: Pick<OnboardingViewProps, "address" | "balance" | "funding" | "onFund"> & { onContinue: () => void }) {
  const funded = balance !== null && balance >= 1.5;
  return (
    <div className="onboarding-copy narrow">
      <span className="eyebrow"><i>03</i> TESTNET READINESS</span>
      <h1>{funded ? "Ready for a real test transaction." : "Fund the Testnet account."}</h1>
      <p>Starpost needs a funded Testnet account for the network reserve and transaction fee. Friendbot distributes valueless Testnet XLM to eligible accounts.</p>
      <dl className="readiness-list">
        <div><dt>NETWORK</dt><dd className="pass">Stellar Testnet</dd></div>
        <div><dt>PUBLIC ADDRESS</dt><dd>{address ? `${address.slice(0, 10)}…${address.slice(-8)}` : "—"}</dd></div>
        <div><dt>BALANCE</dt><dd className={funded ? "pass" : "warn"}>{balance === null ? "Checking…" : `${balance.toFixed(2)} XLM`}</dd></div>
      </dl>
      {!funded && <div className="onboarding-notice"><strong>Testnet only</strong><p>Friendbot cannot fund an already-created account repeatedly. If a low-balance account is ineligible, switch to another Testnet account.</p></div>}
      <div className="onboarding-actions split">
        {!funded && <button className="secondary-action" type="button" disabled={!address || funding} onClick={() => void onFund()}>{funding ? "Requesting XLM…" : "Fund with Friendbot"}</button>}
        <button className="primary-action" type="button" disabled={!funded} onClick={onContinue}>Choose an action <span>→</span></button>
      </div>
    </div>
  );
}

function ActionStep({ progress, transaction, onNavigate }: Pick<OnboardingViewProps, "progress" | "transaction" | "onNavigate">) {
  const guidance = progress.role ? ROLE_GUIDANCE[progress.role] : null;
  if (!guidance) return null;
  function begin() {
    trackProductEvent("onboarding_action_started");
    onNavigate(guidance.destination);
  }
  const failure = transaction.stage === "failed" || transaction.stage === "timed_out";
  return (
    <div className="onboarding-copy narrow">
      <span className="eyebrow"><i>04</i> VERIFIED ACTION</span>
      <h1>{guidance.action}.</h1>
      <p>{guidance.description} Complete the action in the existing product view, approve it in your wallet, and wait for final RPC confirmation. Then return to Start.</p>
      <div className="action-checklist">
        <div><i>01</i><span><strong>Open the product workflow</strong><small>Onboarding never bypasses contract validation.</small></span></div>
        <div><i>02</i><span><strong>Review and approve in your wallet</strong><small>Rejecting a signature submits nothing.</small></span></div>
        <div><i>03</i><span><strong>Wait for confirmed proof</strong><small>Pending and failed transactions do not count.</small></span></div>
      </div>
      {failure && <div className="onboarding-notice error" role="alert"><strong>{transaction.error?.title ?? "Action not confirmed"}</strong><p>{transaction.error?.message ?? "Retry the action when the wallet and network are ready."}</p></div>}
      <div className="onboarding-actions">
        <button className="primary-action" type="button" onClick={begin}>Open {guidance.destination === "proof" ? "Proof to Payout" : guidance.destination} <span>↗</span></button>
      </div>
    </div>
  );
}

function ConfirmationStep({ progress, address, onContinue }: Pick<OnboardingViewProps, "progress" | "address"> & { onContinue: () => void }) {
  const confirmation = progress.confirmedAction;
  if (!confirmation) return null;
  function copy(value: string) {
    void navigator.clipboard?.writeText(value);
  }
  return (
    <div className="onboarding-copy narrow">
      <span className="eyebrow"><i>05</i> TRANSACTION PROOF</span>
      <h1>Confirmed by Stellar RPC.</h1>
      <p>Keep this proof for the Level 5 feedback form. The transaction is public and independently verifiable on Stellar Testnet.</p>
      <dl className="proof-receipt">
        <div><dt>ACTION</dt><dd>{confirmation.action}</dd></div>
        <div><dt>WALLET</dt><dd><code>{address ?? "Connected wallet"}</code><button type="button" onClick={() => address && copy(address)}>Copy</button></dd></div>
        <div><dt>TRANSACTION</dt><dd><code>{confirmation.transactionHash}</code><button type="button" onClick={() => copy(confirmation.transactionHash)}>Copy</button></dd></div>
      </dl>
      <a className="explorer-proof" href={`${EXPLORER_URL}/tx/${confirmation.transactionHash}`} target="_blank" rel="noreferrer">Inspect transaction on Stellar Expert <span>↗</span></a>
      <div className="onboarding-actions">
        <button className="primary-action" type="button" onClick={onContinue}>Share product feedback <span>→</span></button>
      </div>
    </div>
  );
}

function FeedbackStep({ progress, onRestart }: Pick<OnboardingViewProps, "progress" | "onRestart">) {
  return (
    <div className="onboarding-copy narrow">
      <span className="eyebrow"><i>06</i> PRODUCT FEEDBACK</span>
      <h1>Help shape the next release.</h1>
      <p>The form collects your name and email privately for cohort validation. Public evidence removes them and never connects your identity to feedback without consent.</p>
      <div className="feedback-summary">
        <span>YOUR CONFIRMED ACTION</span>
        <strong>{progress.confirmedAction?.action ?? "Testnet action"}</strong>
        <code>{progress.confirmedAction?.transactionHash ?? ""}</code>
      </div>
      {FEEDBACK_FORM_URL ? (
        <a className="primary-action feedback-link" href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer" onClick={() => trackProductEvent("feedback_opened")}>Open the Level 5 feedback form <span>↗</span></a>
      ) : (
        <div className="onboarding-notice" role="status"><strong>Feedback form will open here</strong><p>The verified transaction remains saved on this device. The operator must configure `VITE_FEEDBACK_FORM_URL` before cohort onboarding.</p></div>
      )}
      <div className="onboarding-actions">
        <button className="secondary-action" type="button" onClick={onRestart}>Start another onboarding journey</button>
      </div>
    </div>
  );
}

export function OnboardingView(props: OnboardingViewProps) {
  const { progress } = props;
  return (
    <section className="onboarding-view" aria-labelledby="onboarding-title">
      <header className="onboarding-hero">
        <div><span>LEVEL 5 · GUIDED ONBOARDING</span><strong id="onboarding-title">FROM FIRST VISIT TO VERIFIED ACTION</strong></div>
        <button type="button" onClick={props.onRestart}>Restart</button>
      </header>
      <StepRail current={progress.step} />
      <div className="onboarding-stage">
        {progress.step !== "welcome" && <button className="onboarding-back" type="button" onClick={props.onBack}>← Back</button>}
        {progress.step === "welcome" && <WelcomeStep progress={progress} onChooseRole={(role) => { props.onChooseRole(role); trackProductEvent("onboarding_role_selected"); }} onContinue={() => props.onMove("welcome", "wallet")} />}
        {progress.step === "wallet" && <WalletStep address={props.address} walletName={props.walletName} connecting={props.connecting} onConnect={props.onConnect} onContinue={() => props.onMove("wallet", "testnet")} />}
        {progress.step === "testnet" && <TestnetStep address={props.address} balance={props.balance} funding={props.funding} onFund={props.onFund} onContinue={() => props.onMove("testnet", "action")} />}
        {progress.step === "action" && <ActionStep progress={progress} transaction={props.transaction} onNavigate={props.onNavigate} />}
        {progress.step === "confirmation" && <ConfirmationStep progress={progress} address={props.address} onContinue={() => props.onMove("confirmation", "feedback")} />}
        {progress.step === "feedback" && <FeedbackStep progress={progress} onRestart={props.onRestart} />}
      </div>
    </section>
  );
}
