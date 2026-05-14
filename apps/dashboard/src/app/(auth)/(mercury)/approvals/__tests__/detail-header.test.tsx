import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailHeader } from "../components/detail/header";
import { APPROVALS_FIXTURES } from "../fixtures";

const row = APPROVALS_FIXTURES.find((r) => r.id === "apr_2f1a08")!;

describe("DetailHeader", () => {
  it("renders the summary", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument();
  });

  it("renders the risk pill with the category", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText(/^critical$/i)).toBeInTheDocument();
  });

  it("renders the agent display name not the raw id", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.queryByText(/billing-agent/)).not.toBeInTheDocument();
  });

  it("renders each parametersSnapshot key as a definition list entry", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText("accountId")).toBeInTheDocument();
    expect(screen.getByText("SG-44120")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("renders the live countdown when row has time left", () => {
    const now = Date.now();
    const future = { ...row, expiresAt: new Date(now + 90_000).toISOString() };
    render(<DetailHeader row={future} now={now} />);
    expect(screen.getByText(/1m 30s/)).toBeInTheDocument();
  });
});
