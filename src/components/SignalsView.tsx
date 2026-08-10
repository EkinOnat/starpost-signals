import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRACT_ID, EXPLORER_URL } from "../config";
import type { ActivityEvent } from "../domain/grants";
import { readResults, submitVote } from "../lib/stellar";
import { walletChoices } from "../lib/wallet";
import type { FriendlyError, PollResults } from "../types";
import type { MutationRunner } from "../App";

const FALLBACK_POLL: PollResults = {
  question: "What should Stellar build next?",
  options: ["Payments", "Identity", "Climate", "Gaming"],
  counts: [0, 0, 0, 0],
  total: 0,
};

const DETAILS = [
  { code: "PAY", description: "Frictionless money for everyone", symbol: "↗" },
  { code: "ID", description: "Portable trust and credentials", symbol: "◎" },
  { code: "CLM", description: "Transparent climate action", symbol: "✦" },
  { code: "PLY", description: "Open economies for games", symbol: "◇" },
];

export function SignalsView({
  address,
  walletName,
  balance,
  events,
  onConnect,
  onGrantCategory,
  runMutation,
}: {
  address: string | null;
  walletName: string | null;
  balance: number | null;
  events: ActivityEvent[];
  onConnect: () => Promise<void>;
  onGrantCategory: (category: string) => void;
  runMutation: MutationRunner;
}) {
  const [poll, setPoll] = useState(FALLBACK_POLL);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<FriendlyError | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPoll(await readResults());
      setReadError(null);
    } catch {
      setReadError({
        code: "NETWORK_ERROR",
        title: "Poll sync is delayed",
        message: "The last readable poll snapshot remains visible while RPC reconnects.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (events.some((event) => event.kind === "VoteCast")) void refresh();
  }, [events, refresh]);

  const percentages = useMemo(
    () => poll.counts.map((count) => (poll.total ? Math.round((count / poll.total) * 100) : 0)),
    [poll],
  );

  async function castSignal() {
    if (!address) {
      await onConnect();
      return;
    }
    if (selected === null) return;
    const success = await runMutation("Cast signal", ({ onUpdate }) =>
      submitVote(address, selected, (stage) => onUpdate({ stage })),
    );
    if (success) {
      setSelected(null);
      await refresh();
    }
  }

  const signalEvents = events.filter((event) => event.kind === "VoteCast").slice(0, 6);
  return (
    <div className="view signals-view">
      <section className="signal-hero">
        <div>
          <span className="eyebrow"><i>01</i> SIGNAL WHAT MATTERS</span>
          <h1>Choose the next<br /><em>community orbit.</em></h1>
        </div>
        <div className="hero-aside">
          <p>One wallet. One permanent on-chain vote. Winning signals become categories for work the community can fund and verify.</p>
          <div><strong>{String(poll.total).padStart(2, "0")}</strong><span>LIVE SIGNALS</span></div>
        </div>
      </section>

      <section className="signal-workspace">
        <article className="poll-panel">
          <div className="panel-kicker"><span>CAST YOUR SIGNAL</span><span>{loading ? "SYNCING" : "ON-CHAIN RESULTS"}</span></div>
          <h2>{poll.question}</h2>
          <div className="signal-options">
            {poll.options.map((option, index) => {
              const detail = DETAILS[index] ?? DETAILS[0];
              return (
                <div className={`signal-option${selected === index ? " selected" : ""}`} key={option}>
                  <button type="button" onClick={() => setSelected(index)} aria-pressed={selected === index}>
                    <span className="option-symbol">{detail.symbol}</span>
                    <span><small>{String(index + 1).padStart(2, "0")} · {detail.code}</small><strong>{option}</strong><em>{detail.description}</em></span>
                    <span className="option-total"><strong>{percentages[index]}%</strong><small>{poll.counts[index] ?? 0} {(poll.counts[index] ?? 0) === 1 ? "vote" : "votes"}</small></span>
                    <i style={{ width: `${percentages[index]}%` }} />
                  </button>
                  <button className="fund-category" type="button" onClick={() => onGrantCategory(option)}>Fund this signal →</button>
                </div>
              );
            })}
          </div>
          {address && <div className="wallet-balance"><span>{walletName} · {address.slice(0, 6)}...{address.slice(-5)}</span><strong>{balance?.toFixed(2) ?? "—"} XLM</strong></div>}
          <button className="primary-action" type="button" onClick={() => void castSignal()} disabled={Boolean(address) && selected === null}>
            <span>{address ? "Cast this signal" : "Connect wallet to vote"}</span><span>↗</span>
          </button>
          {readError && <div className="inline-notice" role="status"><strong>{readError.title}</strong><span>{readError.message}</span></div>}
        </article>

        <aside className="orbit-panel">
          <div className="panel-kicker"><span>LIVE ORBIT</span><span className="live-copy"><i /> SYNCHRONIZED</span></div>
          <div className="orbit-visual" aria-label="Live signal distribution">
            <div className="orbit-ring ring-a" /><div className="orbit-ring ring-b" />
            <div className="orbit-core"><span>✦</span><strong>{poll.total}</strong></div>
            {poll.options.map((option, index) => <div className={`orbit-point point-${index + 1}`} key={option}><i>{index + 1}</i><span>{option}</span></div>)}
          </div>
          <div className="mini-feed">
            <div className="feed-title"><span>RECENT SIGNALS</span><span>LIVE</span></div>
            {signalEvents.length ? signalEvents.map((event) => (
              <a key={event.id} href={`${EXPLORER_URL}/tx/${event.txHash}`} target="_blank" rel="noreferrer">
                <i /><span><strong>{event.actor}</strong><small>Signaled {event.category}</small></span><time>{new Date(event.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </a>
            )) : <div className="feed-empty"><strong>Listening on Testnet</strong><span>New VoteCast events appear without a reload.</span></div>}
          </div>
        </aside>
      </section>

      <section className="wallet-options-section">
        <div><span className="eyebrow"><i>02</i> OPEN CONNECTION</span><h2>Bring the wallet<br />you already trust.</h2></div>
        <div className="wallet-options-grid">
          {walletChoices.map((wallet, index) => <button type="button" onClick={() => void onConnect()} disabled={Boolean(address)} key={wallet.name}><small>0{index + 1}</small><strong>{wallet.name}</strong><span>{wallet.note}</span><i>↗</i></button>)}
        </div>
      </section>
      <section className="contract-proof"><span>LIVE SIGNALS CONTRACT</span><code>{CONTRACT_ID}</code><a href={`${EXPLORER_URL}/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">Explorer proof ↗</a></section>
    </div>
  );
}
