import { CONTRACT_ID } from "../config";
import type { ActivityEvent } from "../domain/grants";

type VerifiedSignal = {
  participant: string;
  wallet: string;
  txHash: string;
  ledger: number;
  closedAt: string;
};

// Generated from docs/level4/evidence/user-interactions.csv. Every entry was
// independently verified through RPC, Horizon, the VoteCast contract event,
// source account, and its public Stellar Expert transaction page.
const VERIFIED_SIGNALS: VerifiedSignal[] = [
  { participant: "P01", wallet: "Freighter", txHash: "7cc40089c8013099d6f88ef8c2800f81acfb31eb420a3e4e3587f8ae6d74ac7e", ledger: 4172733, closedAt: "2026-08-16T13:03:27Z" },
  { participant: "P02", wallet: "Freighter", txHash: "d520f326b29191843b321f6059729712749f25ffb73d8e1498f57fe2a750edb7", ledger: 4172874, closedAt: "2026-08-16T13:15:13Z" },
  { participant: "P03", wallet: "Freighter", txHash: "996f55cc5d30c4e0c3500dbdc6ba2f80e72e912c091f64cd976453e2a75ba223", ledger: 4173761, closedAt: "2026-08-16T14:29:15Z" },
  { participant: "P04", wallet: "Freighter", txHash: "01aad71eaf2eae798aae17d380eb77075c4e02c56133e955ed855987160d9034", ledger: 4173994, closedAt: "2026-08-16T14:48:42Z" },
  { participant: "P05", wallet: "Freighter", txHash: "54be143098258e3cadca4b06d60d76212877996863c0d1dbfaa85e8ed18d5b06", ledger: 4174093, closedAt: "2026-08-16T14:56:58Z" },
  { participant: "P06", wallet: "Freighter", txHash: "7621d45ceabb6f52f65c1206b7c8d786d6600e6a605031bf66aa4f41078d76fd", ledger: 4174528, closedAt: "2026-08-16T15:33:16Z" },
  { participant: "P07", wallet: "Freighter", txHash: "de6fa1decef191196aad7904a45244966dec2ccf1c225ef680943047177effc8", ledger: 4174525, closedAt: "2026-08-16T15:33:01Z" },
  { participant: "P08", wallet: "Freighter", txHash: "86e5b3699b9ec10442c2baa261f22282e50a09e916557ae0801a8d48703aaf36", ledger: 4174613, closedAt: "2026-08-16T15:40:22Z" },
  { participant: "P09", wallet: "Freighter", txHash: "d3d9cd9c8adb152e79d0e6b19260d3ad77962066ad17d575c7c83d6496449ed2", ledger: 4176338, closedAt: "2026-08-16T18:04:21Z" },
  { participant: "P10", wallet: "Freighter", txHash: "b8ab9fff51e089944c75eecbe8a71e371fa9b8939106dbe878861e99c2516bd3", ledger: 4176452, closedAt: "2026-08-16T18:13:52Z" },
];

export const VERIFIED_ACTIVITY_EVENTS: ActivityEvent[] = VERIFIED_SIGNALS.map((signal) => ({
  id: `signal-proof:${signal.txHash}`,
  kind: "VoteCast",
  provenance: "verified_archive",
  contractId: CONTRACT_ID,
  actor: `${signal.participant} · ${signal.wallet}`,
  txHash: signal.txHash,
  ledger: signal.ledger,
  closedAt: signal.closedAt,
}));

/**
 * Live/indexed events win when they represent the same activity kind in the
 * same transaction. The verified archive fills only historical gaps, so an
 * unavailable indexer can never turn ten proven interactions into an empty
 * activity screen. Other event kinds in the transaction remain visible.
 */
export function mergeVerifiedActivity(liveEvents: ActivityEvent[]): ActivityEvent[] {
  const liveIdentities = new Set(
    liveEvents.map((event) => `${event.txHash}:${event.kind}`),
  );
  const archivedGaps = VERIFIED_ACTIVITY_EVENTS.filter(
    (event) => !liveIdentities.has(`${event.txHash}:${event.kind}`),
  );
  return [...liveEvents, ...archivedGaps].sort((left, right) => right.ledger - left.ledger);
}
