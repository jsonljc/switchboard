import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalsHeader } from "../components/header";

describe("ApprovalsHeader", () => {
  it("shows the page title", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={1} />);
    expect(screen.getByRole("heading", { level: 1, name: /approvals/i })).toBeInTheDocument();
  });

  it("shows the pending count tile", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={1} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the expiring-soon count tile", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={3} />);
    expect(screen.getByText(/< 1h to expiry/i)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("uses 'Approvals queue' eyebrow, not '/approvals' route path", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={3} />);
    expect(screen.getByText(/^Approvals queue$/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\/approvals/);
  });

  it("contains no engineering vocabulary in visible text", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={3} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/binding|envelope|lifecycle|dispatch/i);
  });
});
