// apps/dashboard/src/components/cockpit/__tests__/kpi-tile.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiTile } from "../kpi-tile";

describe("<KpiTile>", () => {
  it("renders label, value, unit, and trend", () => {
    render(<KpiTile label="qualified" value={28} unit="%" trend="+4 pts" />);
    expect(screen.getByText(/qualified/i)).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(screen.getByText("+4 pts")).toBeInTheDocument();
  });

  it("renders unavailable state with dash and hint button", () => {
    render(<KpiTile label="ad spend" value="—" unavailable hint="Connect Meta Ads" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect Meta Ads/i })).toBeInTheDocument();
  });

  it("annotates trend sign for + / - / neither", () => {
    const { rerender } = render(<KpiTile label="x" value={1} trend="+3" />);
    expect(screen.getByText("+3")).toHaveAttribute("data-trend-sign", "up");
    rerender(<KpiTile label="x" value={1} trend="-3" />);
    expect(screen.getByText("-3")).toHaveAttribute("data-trend-sign", "down");
    rerender(<KpiTile label="x" value={1} trend="0" />);
    expect(screen.getByText("0")).toHaveAttribute("data-trend-sign", "flat");
  });

  it("omits trend element when trend prop missing", () => {
    render(<KpiTile label="bookings" value={9} />);
    expect(screen.queryByText(/^[+-]/)).not.toBeInTheDocument();
  });

  it("renders no hint button when unavailable without hint", () => {
    render(<KpiTile label="ad spend" value="—" unavailable />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
