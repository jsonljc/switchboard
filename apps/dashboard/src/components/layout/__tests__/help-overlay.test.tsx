// apps/dashboard/src/components/layout/__tests__/help-overlay.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { HelpOverlay } from "../help-overlay";

describe("HelpOverlay (editorial)", () => {
  it("renders an editorial title", () => {
    render(<HelpOverlay onClose={() => {}} />);
    // Title is editorial-register; matches the heading element with role="heading"
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("lists exactly H, ?, and Esc shortcuts", () => {
    render(<HelpOverlay onClose={() => {}} />);
    const kbds = screen.getAllByText((_, el) => el?.tagName === "KBD");
    const labels = kbds.map((k) => k.textContent?.trim());
    expect(labels).toEqual(["?", "H", "Esc"]);
  });

  it("does not list 1, 2, or 3 (deferred per spec)", () => {
    render(<HelpOverlay onClose={() => {}} />);
    const kbds = screen.getAllByText((_, el) => el?.tagName === "KBD");
    const labels = kbds.map((k) => k.textContent?.trim());
    expect(labels).not.toContain("1");
    expect(labels).not.toContain("2");
    expect(labels).not.toContain("3");
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HelpOverlay onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked but not when the card body is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<HelpOverlay onClose={onClose} />);
    // Backdrop is the outer presentation element
    const backdrop = container.querySelector('[role="presentation"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    const card = screen.getByRole("dialog");
    await user.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps focus inside the card while open", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay onClose={() => {}} />);
    const card = screen.getByRole("dialog");
    const focusables = card.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(0);
    // Tab from the last focusable should wrap back to the first
    const last = focusables[focusables.length - 1];
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("restores focus to the previously-focused element on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<HelpOverlay onClose={() => {}} />);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
