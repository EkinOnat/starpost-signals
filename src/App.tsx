import { useRef, useState } from "react";
import { ActivityView } from "./components/ActivityView";
import { GrantsView } from "./components/GrantsView";
import { ProofToPayoutView } from "./components/ProofToPayoutView";
import { SignalsView } from "./components/SignalsView";
import { TransactionDrawer } from "./components/TransactionDrawer";
import type { SyncStatus } from "./domain/grants";
import { useGrants } from "./hooks/use-grants";
import { friendlyError, readXlmBalance } from "./lib/stellar";
import type { TransactionUpdate } from "./lib/transaction";
import { connectWallet, disconnectWallet } from "./lib/wallet";
import { trackConfirmedMutation, trackProductEvent } from "./lib/telemetry";
import type { TransactionState } from "./types";

export type MutationContext = {
  address: string;
  onUpdate: (update: TransactionUpdate) => void;
};

export type MutationRunner = (
  label: string,
  action: (context: MutationContext) => Promise<string>,
) => Promise<boolean>;

type View = "signals" | "grants" | "proof" | "activity";

const INITIAL_TRANSACTION: TransactionState = {
  stage: "idle",
  hash: null,
  label: "",
  error: null,
};

function SyncBadge({ status }: { status: SyncStatus }) {
  return <span className={`sync-badge sync-${status}`}><i />{status === "live" ? "LIVE" : status.toUpperCase()}</span>;
}
export default function App() {
  const [view, setView] = useState<View>("signals");
  const [grantCategory, setGrantCategory] = useState<string>();
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [transaction, setTransaction] = useState<TransactionState>(INITIAL_TRANSACTION);
  const mutationLocks = useRef(new Set<string>());
  const { grants, events, syncStatus, grantsStatus, reconcile, retryRegistryRead } = useGrants();

  async function handleConnect(): Promise<string | null> {
    trackProductEvent("wallet_connection_attempted");
    setConnecting(true);
    try {
      const wallet = await connectWallet();
      setAddress(wallet.address);
      setWalletName(wallet.walletName);
      setBalance(await readXlmBalance(wallet.address));
      trackProductEvent("wallet_connected");
      return wallet.address;
    } catch (cause) {
      trackProductEvent("wallet_connection_failed");
      setTransaction({ stage: "failed", hash: null, label: "Connect wallet", error: friendlyError(cause) });
      return null;
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await disconnectWallet();
    setAddress(null);
    setWalletName(null);
    setBalance(null);
  }

  const runMutation: MutationRunner = async (label, action) => {
    const activeAddress = address ?? await handleConnect();
    if (!activeAddress) return false;
    if (mutationLocks.current.has(label)) {
      setTransaction({
        stage: "failed",
        hash: null,
        label,
        error: friendlyError("DUPLICATE_ACTION_PENDING"),
      });
      return false;
    }
    mutationLocks.current.add(label);
    let latestHash: string | null = null;
    setTransaction({ stage: "validating", hash: null, label, error: null });
    try {
      const hash = await action({
        address: activeAddress,
        onUpdate: (update) => {
          if (update.hash) latestHash = update.hash;
          setTransaction({ stage: update.stage, hash: update.hash ?? latestHash, label, error: null });
        },
      });
      latestHash = hash;
      setTransaction({ stage: "confirmed", hash, label, error: null });
      trackConfirmedMutation(label);
      await Promise.allSettled([reconcile(), readXlmBalance(activeAddress).then(setBalance)]);
      return true;
    } catch (cause) {
      const hash = (cause as Error & { hash?: string }).hash ?? latestHash;
      const timedOut = cause instanceof Error && cause.message === "PENDING_TIMEOUT";
      setTransaction({ stage: timedOut ? "timed_out" : "failed", hash, label, error: friendlyError(cause) });
      return false;
    } finally {
      mutationLocks.current.delete(label);
    }
  };

  function openCategory(category: string) {
    setGrantCategory(category);
    setView("grants");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" type="button" onClick={() => setView("signals")} aria-label="Starpost Signals home"><span>✦</span><strong>STARPOST</strong><i>/ SIGNALS</i></button>
        <nav aria-label="Primary navigation">{(["signals", "grants", "proof", "activity"] as const).map((item, index) => <button type="button" className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}><small>0{index + 1}</small>{item}</button>)}</nav>
        <div className="header-actions"><span className="network-badge">TESTNET</span><SyncBadge status={syncStatus} />{address ? <div className="account-pill"><span><small>{walletName}</small><strong>{address.slice(0, 6)}...{address.slice(-5)}</strong></span><button type="button" onClick={() => void handleDisconnect()} aria-label="Disconnect wallet">×</button></div> : <button className="connect-action" type="button" disabled={connecting} onClick={() => void handleConnect()}>{connecting ? "Opening..." : "Connect wallet"}</button>}</div>
      </header>
      <main>
        {view === "signals" && <SignalsView address={address} walletName={walletName} balance={balance} events={events} onConnect={async () => { await handleConnect(); }} onGrantCategory={openCategory} runMutation={runMutation} />}
        {view === "grants" && <GrantsView grants={grants} address={address} initialCategory={grantCategory} runMutation={runMutation} status={grantsStatus} onRetry={retryRegistryRead} />}
        {view === "proof" && <ProofToPayoutView address={address} runMutation={runMutation} />}
        {view === "activity" && <ActivityView events={events} syncStatus={syncStatus} />}
      </main>
      <footer className="site-footer"><span>STARPOST SIGNALS · STELLAR TESTNET</span><span>SIGNAL → FUND → PROVE → APPROVE → PAYOUT</span></footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">{(["signals", "grants", "proof", "activity"] as const).map((item) => <button type="button" className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}><i aria-hidden="true">{item === "signals" ? "✦" : item === "grants" ? "◎" : item === "proof" ? "✓" : "⌁"}</i><span>{item}</span></button>)}</nav>
      <TransactionDrawer transaction={transaction} onDismiss={() => setTransaction(INITIAL_TRANSACTION)} />
    </div>
  );
}
