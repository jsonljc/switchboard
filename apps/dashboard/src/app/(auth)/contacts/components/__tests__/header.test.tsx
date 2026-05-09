import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContactsHeader } from "../header";

describe("ContactsHeader", () => {
  it("renders the brand mark and the same nav cluster as ReportsHeader", () => {
    render(<ContactsHeader />);
    expect(screen.getByLabelText("Switchboard home")).toBeInTheDocument();
    const nav = screen.getByLabelText("agents");
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveTextContent(/Alex/);
    expect(nav).toHaveTextContent(/Riley/);
    expect(screen.getByLabelText("Add an agent")).toBeInTheDocument();
  });

  it("brand mark links to home", () => {
    render(<ContactsHeader />);
    expect(screen.getByLabelText("Switchboard home")).toHaveAttribute("href", "/");
  });

  it("Alex and Riley link to their agent home pages", () => {
    render(<ContactsHeader />);
    expect(screen.getByRole("link", { name: "Alex" })).toHaveAttribute("href", "/alex");
    expect(screen.getByRole("link", { name: "Riley" })).toHaveAttribute("href", "/riley");
  });

  it("does not mark any agent active — /contacts is Tools-tier, not agent-owned", () => {
    const { container } = render(<ContactsHeader />);
    const active = container.querySelectorAll('[class*="isActive"]');
    expect(active.length).toBe(0);
  });

  it("renders the Live pip and the inert Inbox / Halt / Me cluster", () => {
    render(<ContactsHeader />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Halt")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("hides the inbox count chip when the count is 0", () => {
    render(<ContactsHeader />);
    expect(screen.getByLabelText("Inbox, 0 items")).toBeInTheDocument();
  });
});
