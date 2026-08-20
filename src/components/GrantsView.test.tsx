import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GrantView } from "../domain/grants";
import { GrantsView } from "./GrantsView";

vi.mock("../lib/grant-client", () => ({
  cancelGrant: vi.fn(),
  claimRefund: vi.fn(),
  contributeToGrant: vi.fn(),
  createGrant: vi.fn(),
  finalizeFunding: vi.fn(),
  finalizeMilestone: vi.fn(),
  voteMilestone: vi.fn(),
}));

// Mirrors the persisted Testnet state of Registry CCLUIBA3...ICHQ: grant 1 is
// funded and active with milestone 0 released, grant 2 is still funding.
const TESTNET_GRANTS: GrantView[] = [
  {
    id: 2,
    title: "demo",
    description: "Persisted registry state.",
    category: "Payments",
    creator: "GC5DKLTLWPTOQXHDVCCZLKUN54Y5LBNYWQHEESJI76ETCCSKBS332MIH",
    asset: "XLM",
    goal: 1000,
    raised: 0,
    deadline: "2026-08-25T09:00:00.000Z",
    approvalBps: 6000,
    quorumBps: 5000,
    status: "funding",
    currentMilestone: 0,
    recordKind: "test",
    milestones: [
      { index: 0, title: "Prototype and contributor review", amount: 400, yesWeight: 0, noWeight: 0, status: "voting" },
      { index: 1, title: "Public launch and documentation", amount: 600, yesWeight: 0, noWeight: 0, status: "pending" },
    ],
  },
  {
    id: 1,
    title: "Starpost Climate Receipts",
    description: "Persisted registry state.",
    category: "Climate",
    creator: "GAMTIIKC4ZTUTB7DDKV452CCABW4WJQJPYS6KFXW3TAKPTLIFOUTELS7",
    asset: "XLM",
    goal: 100,
    raised: 100,
    deadline: "2027-01-15T00:00:00.000Z",
    approvalBps: 6000,
    quorumBps: 5000,
    status: "active",
    currentMilestone: 1,
    milestones: [
      { index: 0, title: "Public receipt prototype", amount: 40, yesWeight: 100, noWeight: 0, status: "released" },
      { index: 1, title: "Field verification launch", amount: 60, yesWeight: 0, noWeight: 0, status: "voting" },
    ],
  },
];

function summary(container: HTMLElement) {
  return [...container.querySelectorAll(".grant-summary > div")].map((tile) => ({
    label: tile.querySelector("span")?.textContent ?? "",
    value: tile.querySelector("strong")?.textContent?.trim() ?? "",
  }));
}

describe("GrantsView summary", () => {
  it("reports the persisted Testnet totals", () => {
    const { container } = render(
      <GrantsView grants={TESTNET_GRANTS} address={null} runMutation={vi.fn()} status="ready" />,
    );
    expect(summary(container)).toEqual([
      { label: "TOTAL RAISED", value: "100 XLM" },
      { label: "ACTIVE GRANTS", value: "01" },
      { label: "MILESTONES RELEASED", value: "01" },
    ]);
  });

  it("lists the persisted grant instead of the empty orbit state", () => {
    render(<GrantsView grants={TESTNET_GRANTS} address={null} runMutation={vi.fn()} status="ready" />);
    expect(screen.getByRole("button", { name: /starpost climate receipts/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^payments funding demo/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 test record" })).toBeVisible();
    expect(screen.queryByText("No grants in this orbit yet")).not.toBeInTheDocument();
  });

  it("keeps the on-chain test record available behind an explicit disclosure", () => {
    render(<GrantsView grants={TESTNET_GRANTS} address={null} runMutation={vi.fn()} status="ready" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 test record" }));
    expect(screen.getByRole("button", { name: /^payments funding demo/i })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide 1 test record" })).toBeVisible();
  });

  it("keeps an explicitly public zero-funded grant named demo in the public list", () => {
    const publicDemo: GrantView = { ...TESTNET_GRANTS[0], recordKind: "public" };
    render(<GrantsView grants={[publicDemo]} address={null} runMutation={vi.fn()} status="ready" />);
    expect(screen.getByRole("button", { name: /^payments funding demo/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /test record/i })).not.toBeInTheDocument();
  });

  it("keeps the empty orbit state for a category with no grants", () => {
    render(
      <GrantsView grants={TESTNET_GRANTS} address={null} initialCategory="Gaming" runMutation={vi.fn()} status="ready" />,
    );
    expect(screen.getByText("No grants in this orbit yet")).toBeVisible();
  });
});

describe("GrantsView read failures", () => {
  it("shows an error and retry action instead of zeroed totals", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <GrantsView grants={[]} address={null} runMutation={vi.fn()} status="error" onRetry={onRetry} />,
    );
    expect(summary(container).map((tile) => tile.value)).toEqual(["— XLM", "—", "—"]);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("No grants in this orbit yet")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /retry registry read/i })[0]).toBeVisible();
  });

  it("runs the retry action when the operator asks for one", () => {
    const onRetry = vi.fn();
    render(<GrantsView grants={[]} address={null} runMutation={vi.fn()} status="error" onRetry={onRetry} />);
    screen.getAllByRole("button", { name: /retry registry read/i })[0].click();
    expect(onRetry).toHaveBeenCalled();
  });

  it("keeps loaded grants visible while warning about a partial read failure", () => {
    const { container } = render(
      <GrantsView grants={TESTNET_GRANTS} address={null} runMutation={vi.fn()} status="error" onRetry={vi.fn()} />,
    );
    expect(summary(container)[0].value).toBe("100 XLM");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: /starpost climate receipts/i })).toBeVisible();
  });

  it("says it is reading the contract before the first result arrives", () => {
    render(<GrantsView grants={[]} address={null} runMutation={vi.fn()} status="loading" />);
    expect(screen.getByText("Reading the Registry contract")).toBeVisible();
    expect(screen.queryByText("No grants in this orbit yet")).not.toBeInTheDocument();
  });
});
