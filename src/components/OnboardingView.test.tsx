import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createOnboardingProgress, type OnboardingProgress } from "../domain/onboarding";
import type { TransactionState } from "../types";
import { OnboardingView } from "./OnboardingView";

const idle: TransactionState = { stage: "idle", hash: null, label: "", error: null };

function props(progress: OnboardingProgress) {
  return {
    progress,
    address: null,
    walletName: null,
    balance: null,
    connecting: false,
    funding: false,
    transaction: idle,
    onChooseRole: vi.fn(),
    onMove: vi.fn(),
    onBack: vi.fn(),
    onRestart: vi.fn(),
    onConnect: vi.fn().mockResolvedValue("G".repeat(56)),
    onFund: vi.fn().mockResolvedValue(undefined),
    onNavigate: vi.fn(),
  };
}

describe("guided onboarding", () => {
  it("offers four explicit community personas", () => {
    const input = props(createOnboardingProgress());
    render(<OnboardingView {...input} />);
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    fireEvent.click(screen.getByRole("radio", { name: /contributor/i }));
    expect(input.onChooseRole).toHaveBeenCalledWith("contributor");
  });

  it("connects a wallet before advancing to Testnet readiness", async () => {
    const input = props({ ...createOnboardingProgress(), role: "supporter", step: "wallet" });
    render(<OnboardingView {...input} />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await vi.waitFor(() => expect(input.onConnect).toHaveBeenCalledOnce());
    expect(input.onMove).toHaveBeenCalledWith("wallet", "testnet");
  });

  it("keeps the action disabled until the Testnet balance is ready", () => {
    const input = props({ ...createOnboardingProgress(), role: "supporter", step: "testnet" });
    render(<OnboardingView {...input} address={"G".repeat(56)} balance={0} />);
    expect(screen.getByRole("button", { name: /choose an action/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /fund with friendbot/i })).toBeEnabled();
  });

  it("shows only RPC-confirmed proof in the confirmation step", () => {
    const hash = "a".repeat(64);
    const input = props({
      ...createOnboardingProgress(),
      role: "supporter",
      step: "confirmation",
      confirmedAction: { action: "Cast signal", transactionHash: hash },
    });
    render(<OnboardingView {...input} address={"G".repeat(56)} />);
    expect(screen.getByRole("heading", { name: /confirmed by stellar rpc/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toHaveAttribute("href", expect.stringContaining(hash));
  });

  it("does not claim an external form submission when no form is configured", () => {
    const input = props({ ...createOnboardingProgress(), role: "reviewer", step: "feedback" });
    render(<OnboardingView {...input} />);
    expect(screen.getByText(/operator must configure/i)).toBeVisible();
    expect(screen.queryByText(/feedback submitted/i)).not.toBeInTheDocument();
  });
});
