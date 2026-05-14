import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityHeader } from "../header.js";

describe("ActivityHeader", () => {
  it("renders the page title as plain 'Audit log' (no italic accent)", () => {
    const { container } = render(<ActivityHeader lastLedgerEntryIso={null} />);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("Audit log");
    // The title element itself contains no <em> or <i>.
    expect(title.querySelector("em")).toBeNull();
    expect(title.querySelector("i")).toBeNull();
    // No element inside the page-head carries the editorial-italic class.
    expect(container.querySelector("[data-accent='italic']")).toBeNull();
  });

  it("renders the eyebrow 'Mercury Tools · /activity'", () => {
    render(<ActivityHeader lastLedgerEntryIso={null} />);
    expect(screen.getByText(/Mercury Tools · \/activity/)).toBeInTheDocument();
  });

  it("renders the prose subhead about default operational scope", () => {
    render(<ActivityHeader lastLedgerEntryIso={null} />);
    expect(
      screen.getByText(/By default this shows the operator-visible actions/),
    ).toBeInTheDocument();
  });

  it("renders the last ledger entry tile when lastLedgerEntryIso is set", () => {
    render(<ActivityHeader lastLedgerEntryIso="2026-05-10T06:23:11.000Z" />);
    expect(screen.getByText(/last ledger entry/i)).toBeInTheDocument();
    expect(screen.getByText(/chain head/i)).toBeInTheDocument();
  });

  it("hides the last ledger entry tile when lastLedgerEntryIso is null", () => {
    render(<ActivityHeader lastLedgerEntryIso={null} />);
    expect(screen.queryByText(/last ledger entry/i)).not.toBeInTheDocument();
  });

  it("H6: hides the tile when lastLedgerEntryHidden is true even with a valid timestamp", () => {
    const { container } = render(
      <ActivityHeader lastLedgerEntryIso="2026-05-10T06:23:11.000Z" lastLedgerEntryHidden />,
    );
    expect(container.textContent).not.toMatch(/last ledger entry/i);
  });

  it("H6: renders the tile when lastLedgerEntryHidden is false (default)", () => {
    render(<ActivityHeader lastLedgerEntryIso="2026-05-10T06:23:11.000Z" />);
    expect(screen.getByText(/last ledger entry/i)).toBeInTheDocument();
  });
});
