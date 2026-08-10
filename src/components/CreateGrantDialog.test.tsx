import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateGrantDialog } from "./CreateGrantDialog";

vi.mock("../lib/grant-client", () => ({ createGrant: vi.fn() }));

describe("CreateGrantDialog", () => {
  it("uses accessible labels for critical grant fields", () => {
    render(<CreateGrantDialog open onClose={vi.fn()} runMutation={vi.fn()} />);
    expect(screen.getByLabelText("Signals category")).toBeVisible();
    expect(screen.getByLabelText("Funding goal (XLM)")).toBeVisible();
    expect(screen.getByLabelText("Grant title")).toBeVisible();
    expect(screen.getByLabelText("Purpose")).toBeVisible();
  });
  it("keeps review disabled until validation succeeds", () => {
    render(<CreateGrantDialog open onClose={vi.fn()} runMutation={vi.fn()} />);
    expect(screen.getByRole("button", { name: /review grant/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Grant title"), { target: { value: "Useful public grant" } });
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "A sufficiently detailed public purpose for contributor review." } });
    expect(screen.getByRole("button", { name: /review grant/i })).toBeEnabled();
  });
});
