import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageHead } from "../page-head";

const baseProps = {
  dateFolio: "APR 1 — APR 30",
  activeWindow: "THIS MONTH" as const,
  onSelectWindow: vi.fn(),
  onRefresh: vi.fn(),
};

describe("PageHead", () => {
  it("renders the editorial title and a Statement eyebrow without '/reports'", () => {
    render(<PageHead {...baseProps} />);
    expect(screen.getByText("Statement")).toBeInTheDocument();
    expect(screen.queryByText(/\/reports/)).toBeNull();
    expect(screen.getByText(/Operator/)).toBeInTheDocument();
  });

  it("renders the date folio", () => {
    render(<PageHead {...baseProps} />);
    expect(screen.getByText("APR 1 — APR 30")).toBeInTheDocument();
  });

  it("shows '—' for date folio when null", () => {
    render(<PageHead {...baseProps} dateFolio={null} />);
    expect(screen.getByTestId("dateFolio")).toHaveTextContent("—");
  });

  it("marks the active window with aria-pressed=true (per R3)", () => {
    render(<PageHead {...baseProps} />);
    expect(screen.getByRole("button", { name: "THIS MONTH" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "THIS WEEK" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "THIS QUARTER" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("fires onSelectWindow when a window button is clicked", () => {
    const onSelectWindow = vi.fn();
    render(<PageHead {...baseProps} onSelectWindow={onSelectWindow} />);
    fireEvent.click(screen.getByRole("button", { name: "THIS QUARTER" }));
    expect(onSelectWindow).toHaveBeenCalledWith("THIS QUARTER");
  });

  it("Refresh button reads 'Refresh' (not 'Recompute')", () => {
    render(<PageHead {...baseProps} />);
    expect(screen.getByRole("button", { name: /^Refresh$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Recompute/i })).toBeNull();
  });

  it("button label flips to 'Refreshing…' while in-flight", () => {
    render(<PageHead {...baseProps} refreshState="refreshing" cacheAge={0} />);
    expect(screen.getByRole("button", { name: /Refreshing…/i })).toBeInTheDocument();
  });

  it("button label flips to 'Still loading…' at 3s threshold", () => {
    render(<PageHead {...baseProps} refreshState="still-loading" cacheAge={0} />);
    expect(screen.getByRole("button", { name: /Still loading…/i })).toBeInTheDocument();
  });

  it("refresh button is disabled while refreshing", () => {
    render(<PageHead {...baseProps} refreshState="refreshing" cacheAge={0} />);
    expect(screen.getByRole("button", { name: /Refreshing…/i })).toBeDisabled();
  });

  it("window-selector buttons stay enabled during refresh (per R6)", () => {
    render(<PageHead {...baseProps} refreshState="refreshing" cacheAge={0} />);
    expect(screen.getByRole("button", { name: "THIS WEEK" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "THIS MONTH" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "THIS QUARTER" })).not.toBeDisabled();
  });

  it("renders 'cached just now' when cacheAge is 0", () => {
    render(<PageHead {...baseProps} cacheAge={0} />);
    expect(screen.getByText(/cached/)).toBeInTheDocument();
    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it("renders 'cached 47m ago' when cacheAge is 47", () => {
    render(<PageHead {...baseProps} cacheAge={47} />);
    expect(screen.getByText(/47m ago/)).toBeInTheDocument();
  });
});
