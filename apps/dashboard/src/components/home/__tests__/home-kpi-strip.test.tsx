import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeKpiStrip } from "../home-kpi-strip";

const summary = vi.fn();
const decisions = vi.fn();
vi.mock("@/hooks/use-home-summary", () => ({ useHomeSummary: () => summary() }));
vi.mock("@/hooks/use-decision-feed", () => ({ useDecisionFeed: () => decisions() }));

const freshness = { generatedAt: "2026-06-20T00:00:00.000Z", window: "week", dataSource: "live" };

describe("HomeKpiStrip", () => {
  it("renders attributed value as S$ from cents, plus bookings and awaiting-approval", () => {
    summary.mockReturnValue({
      data: {
        attributedValueCents: {
          state: "ready",
          value: 480000,
          comparator: { window: "week", value: 300000 },
          freshness,
        },
        bookings: { state: "ready", value: 5, comparator: { window: "week", value: 3 }, freshness },
        currency: "SGD",
        generatedAt: freshness.generatedAt,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    decisions.mockReturnValue({
      data: { counts: { approval: 2 } },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<HomeKpiStrip />);
    expect(screen.getByText("S$4,800")).toBeInTheDocument(); // 480000 cents
    expect(screen.getByText("Attributed booking value")).toBeInTheDocument();
    expect(screen.getByText(/Booked this week, not yet collected/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // awaiting approval count
  });

  it("renders the honest empty state for the value tile (never S$0)", () => {
    summary.mockReturnValue({
      data: {
        attributedValueCents: { state: "empty", reason: "no_current_week_bookings" },
        bookings: { state: "empty", reason: "no_current_week_bookings" },
        currency: "SGD",
        generatedAt: freshness.generatedAt,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    decisions.mockReturnValue({
      data: { counts: { approval: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<HomeKpiStrip />);
    expect(screen.getByText(/No attributed bookings yet this week/)).toBeInTheDocument();
    expect(screen.queryByText(/S\$0/)).toBeNull();
  });

  it("renders the honest unavailable state for bookings tile when store is down", () => {
    summary.mockReturnValue({
      data: {
        attributedValueCents: {
          state: "ready",
          value: 100000,
          comparator: { window: "week", value: 50000 },
          freshness,
        },
        bookings: { state: "unavailable", reason: "store_unavailable" },
        currency: "SGD",
        generatedAt: freshness.generatedAt,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    decisions.mockReturnValue({
      data: { counts: { approval: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<HomeKpiStrip />);
    expect(screen.getByText("Not available right now.")).toBeInTheDocument();
    expect(screen.queryByText("None yet this week.")).toBeNull();
  });
});
