import { useState } from "react";
import { ActivityView } from "./components/ActivityView";
import { GrantsView } from "./components/GrantsView";
import { SignalsView } from "./components/SignalsView";
import { TransactionDrawer } from "./components/TransactionDrawer";
import type { SyncStatus } from "./domain/grants";
import { useGrants } from "./hooks/use-grants";
import { friendlyError, readXlmBalance } from "./lib/stellar";
import type { TransactionUpdate } from "./lib/transaction";
import { connectWallet, disconnectWallet } from "./lib/wallet";
import type { TransactionState } from "./types";

export type MutationContext = {
  address: string;
  onUpdate: (update: TransactionUpdate) => void;
};

export type MutationRunner = (
  label: string,
  action: (context: MutationContext) => Promise<string>,
) => Promise<boolean>;

type View = "signals" | "grants" | "activity";

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
  const { grants, events, syncStatus, reconcile } = useGrants();

  async function handleConnect() {
    setConnecting(true);
    try {
      const wallet = await connectWallet();
      setAddress(wallet.address);
      setWalletName(wallet.walletName);
      setBalance(await readXlmBalance(wallet.address));
    } catch (cause) {
      setTransaction({ stage: "failed", hash: null, label: "Connect wallet", error: friendlyError(cause) });
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
    if (!address) {
      await handleConnect();
      return false;
    }
    let latestHash: string | null = null;
    setTransaction({ stage: "validating", hash: null, label, error: null });
    try {
      const hash = await action({
        address,
        onUpdate: (update) => {
          if (update.hash) latestHash = update.hash;
          setTransaction({ stage: update.stage, hash: update.hash ?? latestHash, label, error: null });
        },
      });
      latestHash = hash;
      setTransaction({ stage: "success", hash, label, error: null });
      await Promise.allSettled([reconcile(), readXlmBalance(address).then(setBalance)]);
      return true;
    } catch (cause) {
      const hash = (cause as Error & { hash?: string }).hash ?? latestHash;
      setTransaction({ stage: "failed", hash, label, error: friendlyError(cause) });
      return false;
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
        <nav aria-label="Primary navigation">{(["signals", "grants", "activity"] as const).map((item, index) => <button type="button" className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}><small>0{index + 1}</small>{item}</button>)}</nav>
        <div className="header-actions"><span className="network-badge">TESTNET</span><SyncBadge status={syncStatus} />{address ? <div className="account-pill"><span><small>{walletName}</small><strong>{address.slice(0, 6)}...{address.slice(-5)}</strong></span><button type="button" onClick={() => void handleDisconnect()} aria-label="Disconnect wallet">×</button></div> : <button className="connect-action" type="button" disabled={connecting} onClick={() => void handleConnect()}>{connecting ? "Opening..." : "Connect wallet"}</button>}</div>
      </header>
      <main>
        {view === "signals" && <SignalsView address={address} walletName={walletName} balance={balance} events={events} onConnect={handleConnect} onGrantCategory={openCategory} runMutation={runMutation} />}
        {view === "grants" && <GrantsView grants={grants} address={address} initialCategory={grantCategory} runMutation={runMutation} />}
        {view === "activity" && <ActivityView events={events} syncStatus={syncStatus} />}
      </main>
      <footer className="site-footer"><span>STARPOST SIGNALS · STELLAR TESTNET</span><span>SIGNAL → FUND → DELIVER</span></footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">{(["signals", "grants", "activity"] as const).map((item) => <button type="button" className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}><i>{item === "signals" ? "✦" : item === "grants" ? "◎" : "⌁"}</i><span>{item}</span></button>)}</nav>
      <TransactionDrawer transaction={transaction} onDismiss={() => setTransaction(INITIAL_TRANSACTION)} />
    </div>
  );
}
