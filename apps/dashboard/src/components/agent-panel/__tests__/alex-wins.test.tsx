import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let data: unknown = undefined;
let isLoading = false;
let isError = false;
let error: unknown = null;
vi.mock("@/hooks/use-agent-wins", () => ({
  useAgentWins: () => ({ data, isLoading, isError, error }),
}));

import { AlexWins } from "../alex-wins";

function win(over: Record<string, unknown> = {}) {
  return {
    traceId: "trace_abcdef12",
    bookingId: "bk_1",
    contactId: "c_1",
    service: "botox",
    bookingStatus: "confirmed",
    valueCents: 45000,
    revenuePending: false,
    sourceCampaignId: "camp_9",
    timeFolio: "9:00 AM",
    occurredAtIso: "2026-06-12T03:00:00Z",
    ...over,
  };
}

describe("AlexWins", () => {
  beforeEach(() => {
    data = undefined;
    isLoading = false;
    isError = false;
    error = null;
  });

  it("loading → skeleton (aria-busy), no error/empty copy", () => {
    isLoading = true;
    const { container } = render(<AlexWins />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText("Couldn't load wins")).not.toBeInTheDocument();
    expect(screen.queryByText("No bookings yet")).not.toBeInTheDocument();
  });

  it("error → 'Couldn't load wins', never empty copy", () => {
    isError = true;
    error = new Error("boom");
    render(<AlexWins />);
    expect(screen.getByText("Couldn't load wins")).toBeInTheDocument();
    expect(screen.queryByText("No bookings yet")).not.toBeInTheDocument();
  });

  it("keys-pending (undefined, no error) → loading skeleton, not error", () => {
    const { container } = render(<AlexWins />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText("Couldn't load wins")).not.toBeInTheDocument();
  });

  it("empty → 'No bookings yet'", () => {
    data = { wins: [], hasMore: false, freshness: { generatedAt: "x", dataSource: "live" } };
    render(<AlexWins />);
    expect(screen.getByText("No bookings yet")).toBeInTheDocument();
  });

  it("renders a win with service, formatted revenue and a trace reference", () => {
    data = { wins: [win()], hasMore: false, freshness: { generatedAt: "x", dataSource: "live" } };
    const { container } = render(<AlexWins />);
    expect(screen.getByText(/Booked botox · \$450/)).toBeInTheDocument();
    // trace provenance surfaced (full id on the row, short id visible)
    expect(container.querySelector('[data-trace-id="trace_abcdef12"]')).not.toBeNull();
    expect(screen.getByText(/#trace_ab/)).toBeInTheDocument();
  });

  it("renders 'revenue pending' when the conversion has not settled (no fabricated amount)", () => {
    data = {
      wins: [win({ valueCents: null, revenuePending: true, sourceCampaignId: null })],
      hasMore: false,
      freshness: { generatedAt: "x", dataSource: "live" },
    };
    render(<AlexWins />);
    expect(screen.getByText(/Booked botox · revenue pending/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
