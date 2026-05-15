import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "../command-palette";
import { ALEX_COMMANDS } from "@/lib/cockpit/alex-commands";
import { RILEY_COMMANDS } from "@/lib/cockpit/riley/riley-config";
import type { Command } from "../types";

const noop = () => {};

describe("<CommandPalette>", () => {
  it("renders all groups when open", () => {
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    expect(screen.getByText("Open settings")).toBeInTheDocument();
    expect(screen.getByText("Pause Alex for 1 hour")).toBeInTheDocument();
    expect(screen.getByText("Stop offering the founder rate")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(<CommandPalette open={false} onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    expect(screen.queryByText("Open settings")).not.toBeInTheDocument();
  });

  it("type-to-filter narrows visible commands", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    await user.type(screen.getByRole("searchbox"), "pause");
    expect(screen.getByText("Pause Alex for 1 hour")).toBeInTheDocument();
    expect(screen.queryByText("Open settings")).not.toBeInTheDocument();
  });

  it("thread-group commands disabled when threadContext is undefined", () => {
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    const followup = screen.getByText("Follow up with {contact} tonight").closest("button");
    expect(followup).toBeDisabled();
  });

  it("hold-named is rendered but disabled (inert in A.5)", () => {
    // hold-named appears in ALEX_COMMANDS but has no corresponding
    // ParsedActionKind in A.5. The palette's thread-group disable behavior
    // keeps it inert because threadContext is always undefined at the A.5
    // CockpitPage call site. This case locks the catalog/dispatcher
    // asymmetry — see slice brief §"Typed `hold` action kind" non-goal.
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    const hold = screen.getByText("Hold {contact}, don't send anything").closest("button");
    expect(hold).toBeInTheDocument();
    expect(hold).toBeDisabled();
  });

  it("renders groups in operational-first order (control → thread → rules → nav)", () => {
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    const labels = screen.getAllByText(/^(Control|Thread|Rules|Navigate)$/);
    expect(labels.map((el) => el.textContent)).toEqual(["Control", "Thread", "Rules", "Navigate"]);
  });

  it("thread-group commands enabled when threadContext present", () => {
    render(
      <CommandPalette
        open
        onClose={noop}
        commands={ALEX_COMMANDS}
        onSelect={noop}
        threadContext={{ contactId: "c1", displayName: "Maya" }}
      />,
    );
    const followup = screen.getByText(/Follow up/).closest("button");
    expect(followup).not.toBeDisabled();
  });

  it("Enter fires onSelect with the focused command", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={onSelect} />);
    await user.type(screen.getByRole("searchbox"), "pause 1");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalled();
    const firstCall = onSelect.mock.calls[0]![0] as Command;
    expect(firstCall.id).toBe("pause-1h");
  });

  it("Escape fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={ALEX_COMMANDS} onSelect={noop} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("agent-agnostic: renders Riley fixture without errors", () => {
    render(<CommandPalette open onClose={noop} commands={RILEY_COMMANDS} onSelect={noop} />);
    expect(screen.getByText("Open Meta")).toBeInTheDocument();
    expect(screen.getByText("Pause Riley for 1h")).toBeInTheDocument();
  });

  it("Riley thread-group commands without {…} placeholders are enabled even when threadContext is undefined", () => {
    render(<CommandPalette open onClose={noop} commands={RILEY_COMMANDS} onSelect={noop} />);
    const brief = screen.getByText("Brief me at EOD").closest("button");
    const cpl = screen.getByText("Show CPL — last 30d").closest("button");
    expect(brief).not.toBeDisabled();
    expect(cpl).not.toBeDisabled();
  });
});
