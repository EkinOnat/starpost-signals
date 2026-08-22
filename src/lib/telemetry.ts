import { APP_RELEASE, INDEXER_URL } from "../config";

export type ProductEvent =
  | "onboarding_role_selected"
  | "onboarding_wallet_ready"
  | "onboarding_action_started"
  | "onboarding_action_confirmed"
  | "feedback_opened"
  | "wallet_connection_attempted"
  | "wallet_connected"
  | "wallet_connection_failed"
  | "project_viewed"
  | "project_created"
  | "contribution_started"
  | "contribution_confirmed"
  | "evidence_submission_started"
  | "evidence_submitted"
  | "reviewer_attestation_confirmed"
  | "milestone_vote_confirmed"
  | "dispute_opened"
  | "payout_confirmed"
  | "refund_confirmed";

export function trackProductEvent(event: ProductEvent) {
  if (!INDEXER_URL || navigator.doNotTrack === "1") return;
  const payload = JSON.stringify({ event, release: APP_RELEASE });
  try {
    if (navigator.sendBeacon?.(`${INDEXER_URL}/api/v1/telemetry`, new Blob([payload], { type: "application/json" }))) return;
    void fetch(`${INDEXER_URL}/api/v1/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics is best-effort and never blocks a wallet or contract action.
  }
}

export function trackConfirmedMutation(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("create proof")) trackProductEvent("project_created");
  else if (normalized.includes("contribute")) trackProductEvent("contribution_confirmed");
  else if (normalized.includes("anchor evidence")) trackProductEvent("evidence_submitted");
  else if (normalized.includes("verify milestone") || normalized.includes("reject milestone evidence")) trackProductEvent("reviewer_attestation_confirmed");
  else if (normalized.includes("approve milestone")) trackProductEvent("milestone_vote_confirmed");
  else if (normalized.includes("dispute milestone")) trackProductEvent("dispute_opened");
  else if (normalized.includes("release milestone")) trackProductEvent("payout_confirmed");
  else if (normalized.includes("claim project refund")) trackProductEvent("refund_confirmed");
}
