import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpOverlay } from "../help-overlay";

describe("HelpOverlay", () => {
  it("renders the heading and shortcut groups", () => {
    render(<HelpOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /how switchboard works/i })).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 / 3")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });

  it("clicking the close button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the backdrop calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<HelpOverlay onClose={onClose} />);
    const overlay = container.querySelector(".overlay");
    expect(overlay).not.toBeNull();
    await user.click(overlay!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking inside the help-card does NOT call onClose (event stopped)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    await user.click(screen.getByRole("heading", { name: /how switchboard works/i }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses the close button when opened", () => {
    render(<HelpOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).toHaveFocus();
  });

  it("restores focus to the previously-focused element on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(<HelpOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("traps Tab inside the dialog (Tab from last element wraps to first)", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay onClose={vi.fn()} />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toHaveFocus();
    // Only one focusable element exists in the card (the close button), so
    // Tab from it should wrap back to itself.
    await user.tab();
    expect(closeBtn).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeBtn).toHaveFocus();
  });
});
