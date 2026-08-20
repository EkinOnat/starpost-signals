import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readImpactProjects } from "../lib/impact-client";
import { ProofToPayoutView } from "./ProofToPayoutView";

vi.mock("../lib/impact-client", () => ({
  acceptImpactRole: vi.fn(),
  activateImpactProject: vi.fn(),
  applyImpactTimeout: vi.fn(),
  arbitrateImpact: vi.fn(),
  attestImpact: vi.fn(),
  cancelImpactProject: vi.fn(),
  claimImpactRefund: vi.fn(),
  contributeImpact: vi.fn(),
  createImpactProject: vi.fn(),
  finalizeImpactDispute: vi.fn(),
  finalizeImpactFunding: vi.fn(),
  finalizeImpactReview: vi.fn(),
  finalizeImpactVote: vi.fn(),
  openImpactFunding: vi.fn(),
  openImpactReview: vi.fn(),
  openImpactVoting: vi.fn(),
  readImpactProjects: vi.fn(),
  releaseImpactMilestone: vi.fn(),
  startImpactRework: vi.fn(),
  submitImpactEvidence: vi.fn(),
  voteImpact: vi.fn(),
}));

describe("ProofToPayoutView deployment proof", () => {
  beforeEach(() => {
    vi.mocked(readImpactProjects).mockResolvedValue([]);
  });

  it("shows immutable deployment evidence instead of an unfinished zero dashboard", async () => {
    render(<ProofToPayoutView address={null} runMutation={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Proof infrastructure is live" })).toBeVisible();
    expect(screen.getByText("DEPLOYED V1 CONTRACTS")).toBeVisible();
    expect(screen.getByText("VERIFIED TRANSACTIONS")).toBeVisible();
    expect(screen.getByRole("link", { name: /Impact Registry V1/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Impact Escrow V1/i })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Deployment proof transactions" }).querySelectorAll("a")).toHaveLength(6);
    expect(screen.queryByText("ACTIVE PROJECTS")).not.toBeInTheDocument();
    expect(screen.queryByText("No proof projects yet")).not.toBeInTheDocument();
  });
});
