import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../domain/grants";
import { ActivityView } from "./ActivityView";

const liveEvent: ActivityEvent = {
  id: "live-grant-event",
  kind: "FundsReleased",
  contractId: "CREGISTRY",
  grantId: 1,
  actor: "Registry",
  amount: 40,
  txHash: "live-release-hash",
  ledger: 4_200_000,
  closedAt: "2026-08-18T12:00:00Z",
};

describe("ActivityView verified history", () => {
  it("shows ten proven wallet interactions when the recent event window is empty", () => {
    render(<ActivityView events={[]} syncStatus="live" />);
    expect(screen.getByText("10 VERIFIED EVENTS")).toBeVisible();
    expect(screen.getByText("RPC CONNECTED")).toBeVisible();
    expect(screen.getByText("P10 · Freighter")).toBeVisible();
    expect(screen.getAllByText("PROVEN")).toHaveLength(10);
    expect(screen.getAllByRole("link")).toHaveLength(10);
  });

  it("adds new live activity without dropping the verified archive", () => {
    render(<ActivityView events={[liveEvent]} syncStatus="live" />);
    expect(screen.getByText("11 VERIFIED EVENTS")).toBeVisible();
    expect(screen.getByText("Registry")).toBeVisible();
    expect(screen.getByText("LIVE")).toBeVisible();
  });

  it("deduplicates a live event that has the same transaction hash as archived proof", () => {
    render(<ActivityView events={[{
      ...liveEvent,
      txHash: "b8ab9fff51e089944c75eecbe8a71e371fa9b8939106dbe878861e99c2516bd3",
    }]} syncStatus="live" />);
    expect(screen.getByText("10 VERIFIED EVENTS")).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(10);
  });
});
