import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionDrawer } from "./TransactionDrawer";

describe("TransactionDrawer", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<TransactionDrawer transaction={{ stage: "idle", hash: null, label: "", error: null }} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows every transaction stage", () => {
    render(<TransactionDrawer transaction={{ stage: "pending", hash: "hash", label: "Contribute XLM", error: null }} onDismiss={vi.fn()} />);
    for (const label of ["Validate", "Simulate", "Sign", "Submit", "Confirm"]) expect(screen.getByText(label)).toBeVisible();
  });
  it("links a confirmed hash to Testnet Explorer", () => {
    render(<TransactionDrawer transaction={{ stage: "success", hash: "deadbeef", label: "Create grant", error: null }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("link", { name: /check transaction/i })).toHaveAttribute("href", expect.stringContaining("deadbeef"));
  });
  it("renders a neutral pending-timeout recovery state", () => {
    render(<TransactionDrawer transaction={{ stage: "failed", hash: "hash", label: "Vote", error: { code: "PENDING_TIMEOUT", title: "Confirmation is taking longer", message: "Check status." } }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Check status");
  });
});

