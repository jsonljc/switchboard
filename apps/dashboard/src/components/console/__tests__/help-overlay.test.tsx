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
});
