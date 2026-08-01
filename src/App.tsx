import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRACT_ID, EXPLORER_URL } from "./config";
import {
  fetchVoteEvents,
  friendlyError,
  readResults,
  readXlmBalance,
  submitVote,
} from "./lib/stellar";
import { connectWallet, disconnectWallet, walletChoices } from "./lib/wallet";
import type {
  FriendlyError,
  PollResults,
  TransactionStage,
  VoteEvent,
} from "./types";

const FALLBACK_POLL: PollResults = {
  question: "What should Stellar build next?",
  options: ["Payments", "Identity", "Climate", "Gaming"],
  counts: [0, 0, 0, 0],
  total: 0,
};

const OPTION_DETAILS = [
  { code: "PAY", description: "Frictionless money for everyone", glyph: "↗" },
  { code: "ID", description: "Portable trust and credentials", glyph: "◎" },
  { code: "CLM", description: "Transparent climate action", glyph: "✦" },
  { code: "PLY", description: "Open economies for games", glyph: "◇" },
];

function shorten(value: string, lead = 6, tail = 5) {
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

function stageLabel(stage: TransactionStage) {
  switch (stage) {
    case "simulating":
      return "Checking contract…";
    case "awaiting_signature":
      return "Approve in wallet";
    case "pending":
      return "Confirming on Testnet…";
    case "success":
      return "Signal confirmed";
    case "failed":
      return "Try again";
    default:
      return "Cast this signal";
  }
}

function App() {
  const [poll, setPoll] = useState<PollResults>(FALLBACK_POLL);
  const [isLoading, setIsLoading] = useState(true);
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [stage, setStage] = useState<TransactionStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [events, setEvents] = useState<VoteEvent[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshResults = useCallback(async () => {
    try {
      setPoll(await readResults());
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshResults();
  }, [refreshResults]);

  useEffect(() => {
    let active = true;
    let cursor: string | undefined;

    const syncEvents = async () => {
      try {
        const page = await fetchVoteEvents(cursor);
        cursor = page.cursor;
        if (!active || page.events.length === 0) return;

        setEvents((current) => {
          const merged = [...page.events, ...current];
          return merged
            .filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index)
            .sort((a, b) => b.ledger - a.ledger)
            .slice(0, 8);
        });
        await refreshResults();
      } catch {
        // The next polling cycle retries. Voting remains available if event RPC is delayed.
      }
    };

    void syncEvents();
    const timer = window.setInterval(() => void syncEvents(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshResults]);

  const percentages = useMemo(
    () => poll.counts.map((count) => (poll.total ? Math.round((count / poll.total) * 100) : 0)),
    [poll],
  );

  async function handleConnect() {
    setIsConnecting(true);
    setError(null);
    try {
      const connected = await connectWallet();
      setAddress(connected.address);
      setWalletName(connected.walletName);
      setBalance(await readXlmBalance(connected.address));
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectWallet();
    } finally {
      setAddress(null);
      setWalletName(null);
      setBalance(null);
      setSelected(null);
      setStage("idle");
      setError(null);
    }
  }

  async function handleVote() {
    if (!address) {
      await handleConnect();
      return;
    }
    if (selected === null) return;

    setError(null);
    setTxHash(null);
    try {
      const hash = await submitVote(address, selected, setStage);
      setTxHash(hash);
      setStage("success");
      setPoll(await readResults());
      setBalance(await readXlmBalance(address));
    } catch (cause) {
      setStage("failed");
      setError(friendlyError(cause));
    }
  }

  async function copyContract() {
    await navigator.clipboard.writeText(CONTRACT_ID);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  const busy = ["simulating", "awaiting_signature", "pending"].includes(stage);

  return (
    <div className="app-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Starpost Signals home">
          <span className="brand-mark">✦</span>
          <span>STARPOST</span>
          <span className="brand-muted">/ SIGNALS</span>
        </a>

        <div className="header-actions">
          <div className="network-pill"><span /> TESTNET · LIVE</div>
          {address ? (
            <div className="account-cluster">
              <div className="account-copy">
                <span>{walletName}</span>
                <strong>{shorten(address)}</strong>
              </div>
              <button className="icon-button" onClick={handleDisconnect} title="Disconnect wallet" aria-label="Disconnect wallet">×</button>
            </div>
          ) : (
            <button className="connect-button" onClick={handleConnect} disabled={isConnecting}>
              <span className="connect-dot" /> {isConnecting ? "Opening wallets…" : "Connect wallet"}
            </button>
          )}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="eyebrow"><span>LEVEL 02</span> · A REAL-TIME SOROBAN EXPERIMENT</div>
          <h1>Choose the next<br /><em>signal.</em></h1>
          <div className="hero-foot">
            <p>One wallet. One vote. A permanent on-chain pulse for what the Stellar ecosystem should build next.</p>
            <div className="hero-stat">
              <span>LIVE RESPONSES</span>
              <strong>{String(poll.total).padStart(2, "0")}</strong>
            </div>
          </div>
        </section>

        <section className="workspace">
          <article className="poll-card">
            <div className="card-kicker">
              <span>01 / CAST YOUR VOTE</span>
              <span>{isLoading ? "SYNCING" : `${poll.total} SIGNAL${poll.total === 1 ? "" : "S"}`}</span>
            </div>
            <h2>{poll.question}</h2>
            <p className="card-lede">Select the idea you believe creates the strongest new orbit.</p>

            <div className="option-list">
              {poll.options.map((option, index) => {
                const detail = OPTION_DETAILS[index] ?? OPTION_DETAILS[0];
                const isSelected = selected === index;
                return (
                  <button
                    className={`poll-option${isSelected ? " selected" : ""}`}
                    key={option}
                    onClick={() => {
                      if (!busy && stage !== "success") {
                        setSelected(index);
                        setError(null);
                        setStage("idle");
                      }
                    }}
                    aria-pressed={isSelected}
                    disabled={busy || stage === "success"}
                  >
                    <span className="option-glyph">{detail.glyph}</span>
                    <span className="option-copy">
                      <span className="option-code">{String(index + 1).padStart(2, "0")} · {detail.code}</span>
                      <strong>{option}</strong>
                      <small>{detail.description}</small>
                    </span>
                    <span className="option-result">
                      <strong>{percentages[index]}%</strong>
                      <small>{poll.counts[index] ?? 0} votes</small>
                    </span>
                    <span className="result-bar" style={{ width: `${percentages[index]}%` }} />
                  </button>
                );
              })}
            </div>

            {address && (
              <div className="wallet-strip">
                <span>CONNECTED VIA {walletName?.toUpperCase()}</span>
                <strong>{balance === null ? "…" : balance.toFixed(2)} XLM</strong>
              </div>
            )}

            <button
              className={`vote-button stage-${stage}`}
              onClick={handleVote}
              disabled={(address !== null && selected === null) || busy || stage === "success"}
            >
              <span>{address ? stageLabel(stage) : "Connect wallet to vote"}</span>
              <span className="vote-arrow">{stage === "success" ? "✓" : "↗"}</span>
            </button>

            <div className="transaction-steps" aria-live="polite">
              <span className={stage !== "idle" && stage !== "failed" ? "active" : ""}>1 · SIMULATE</span>
              <i />
              <span className={["awaiting_signature", "pending", "success"].includes(stage) ? "active" : ""}>2 · SIGN</span>
              <i />
              <span className={["pending", "success"].includes(stage) ? "active" : ""}>3 · CONFIRM</span>
            </div>

            {error && (
              <div className="error-panel" role="alert">
                <span className="error-symbol">!</span>
                <div><strong>{error.title}</strong><p>{error.message}</p></div>
                <span className="error-code">{error.code}</span>
              </div>
            )}

            {txHash && (
              <div className="success-panel" role="status">
                <span className="success-symbol">✓</span>
                <div>
                  <strong>Your signal is on-chain.</strong>
                  <p>Transaction {shorten(txHash, 8, 7)} confirmed on Stellar Testnet.</p>
                </div>
                <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer">VIEW ↗</a>
              </div>
            )}
          </article>

          <aside className="signal-card">
            <div className="card-kicker"><span>02 / LIVE ORBIT</span><span className="live-label"><i /> SYNCED</span></div>
            <div className="orbit" aria-label="Live poll visualization">
              <div className="orbit-ring ring-one" />
              <div className="orbit-ring ring-two" />
              <div className="orbit-cross horizontal" />
              <div className="orbit-cross vertical" />
              <div className="core"><span>✦</span><small>{poll.total}</small></div>
              {poll.options.map((option, index) => (
                <div
                  className={`orbit-node node-${index + 1}`}
                  key={option}
                  style={{ "--pulse": `${Math.max(0.35, percentages[index] / 100)}` } as React.CSSProperties}
                >
                  <span>{index + 1}</span>
                  <small>{option}</small>
                </div>
              ))}
            </div>

            <div className="activity-head">
              <span>CONTRACT EVENTS</span>
              <span>AUTO-REFRESH · 5S</span>
            </div>
            <div className="activity-feed">
              {events.length === 0 ? (
                <div className="empty-activity">
                  <span>⌁</span>
                  <strong>Listening for the first vote</strong>
                  <p>New contract events will appear here without reloading the page.</p>
                </div>
              ) : (
                events.map((event) => (
                  <a className="activity-row" key={event.id} href={`${EXPLORER_URL}/tx/${event.txHash}`} target="_blank" rel="noreferrer">
                    <span className="activity-ping" />
                    <span><strong>{event.voter}</strong><small>Voted {poll.options[event.option] ?? `option ${event.option + 1}`}</small></span>
                    <time>{new Date(event.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </a>
                ))
              )}
            </div>
          </aside>
        </section>

        <section className="wallet-section">
          <div className="section-title">
            <span>03 / OPEN CONNECTION</span>
            <h2>Bring the wallet<br />you already trust.</h2>
          </div>
          <div className="wallet-grid">
            {walletChoices.map((wallet, index) => (
              <button key={wallet.name} onClick={handleConnect} disabled={Boolean(address) || isConnecting}>
                <span className="wallet-number">0{index + 1}</span>
                <strong>{wallet.name}</strong>
                <small>{wallet.note}</small>
                <span className="wallet-arrow">↗</span>
              </button>
            ))}
          </div>
        </section>

        <section className="proof-section">
          <div>
            <span className="proof-label">DEPLOYED CONTRACT</span>
            <strong>{shorten(CONTRACT_ID, 12, 10)}</strong>
          </div>
          <button onClick={copyContract}>{copied ? "COPIED ✓" : "COPY ADDRESS"}</button>
          <a href={`${EXPLORER_URL}/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">OPEN IN EXPLORER ↗</a>
        </section>
      </main>

      <footer>
        <span>STARPOST SIGNALS · BUILT ON STELLAR / SOROBAN</span>
        <span>ONE ADDRESS · ONE SIGNAL · TESTNET ONLY</span>
      </footer>
    </div>
  );
}

export default App;
