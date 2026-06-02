// apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KPIStrip } from "../kpi-strip";
import type { CockpitKpiData } from "../types";

const flatKpis: CockpitKpiData = {
  range: "This week · May 12 – May 18",
  booked: 9,
  bookedDelta: "+3",
  leads: 47,
  leadsDelta: "+12",
  qualifiedPct: 28,
  qualifiedDelta: "+4 pts",
  spend: 214,
  avgValue: 179,
  target: 30,
};

describe("<KPIStrip>", () => {
  it("renders four tiles + ROI bar in steady state", () => {
    render(<KPIStrip kpis={flatKpis} />);
    expect(screen.getByText(/bookings/i)).toBeInTheDocument();
    expect(screen.getByText(/leads worked/i)).toBeInTheDocument();
    expect(screen.getByText(/qualified/i)).toBeInTheDocument();
    expect(screen.getByText(/ad spend/i)).toBeInTheDocument();
    expect(screen.getByText(/return on spend/i)).toBeInTheDocument();
    expect(screen.getByText(/This week/i)).toBeInTheDocument();
  });

  it("renders collapsed single-line headline when collapsed=true", () => {
    render(<KPIStrip kpis={flatKpis} collapsed />);
    // ROI bar is hidden in collapsed mode
    expect(screen.queryByText(/return on spend/i)).not.toBeInTheDocument();
    // bookings hero value rendered in collapsed line
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open report/i })).toBeInTheDocument();
  });

  it("prefers explicit tiles[] over legacy adapter", () => {
    render(
      <KPIStrip
        kpis={{
          range: "This week",
          tiles: [{ label: "ROAS", value: "3.2×", trend: "+0.4×" }],
        }}
      />,
    );
    expect(screen.getByText(/ROAS/i)).toBeInTheDocument();
    expect(screen.queryByText(/leads worked/i)).not.toBeInTheDocument();
  });

  it("handles degraded ROI gracefully (no fill bar, hint shown)", () => {
    render(<KPIStrip kpis={{ ...flatKpis, spend: null }} />);
    expect(screen.queryByTestId("roi-bar-fill")).not.toBeInTheDocument();
    expect(screen.getByText(/Connect Meta Ads to see return on spend/i)).toBeInTheDocument();
  });

  it("collapsed mode falls back to flat headline when no explicit tiles[]", () => {
    render(<KPIStrip kpis={flatKpis} collapsed />);
    // "9 bookings · $24 each · +3"
    expect(screen.getByText(/bookings/)).toBeInTheDocument();
    expect(screen.getByText(/each/)).toBeInTheDocument();
  });

  it("collapsed mode reads first non-unavailable explicit tile", () => {
    render(
      <KPIStrip
        collapsed
        kpis={{
          range: "This week",
          tiles: [
            { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" },
            { label: "ROAS", value: "3.2×", trend: "+0.4×" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/ROAS/i)).toBeInTheDocument();
    expect(screen.getByText("3.2×")).toBeInTheDocument();
  });

  it("forwards accent prop through to <ROIBar>", () => {
    const RILEY_ACCENT = {
      base: "#B86C50",
      deep: "#7E4533",
      soft: "#ECD4C8",
      paper: "#F6E7DE",
    };
    render(
      <KPIStrip
        kpis={{
          range: "This week · Mon — Wed",
          tiles: [
            { label: "leads", value: 27, trend: "+5" },
            { label: "ctr", value: "—", unavailable: true },
            { label: "ad spend", value: "$200" },
          ],
          roi: {
            degraded: true,
            degradedHint: "",
            label: "cost per booked",
            comparator: { value: "$7 per booked", target: "target $5" },
          },
        }}
        accent={RILEY_ACCENT}
      />,
    );
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveStyle({
      background: RILEY_ACCENT.paper,
      borderColor: RILEY_ACCENT.soft,
    });
  });

  it("exposes data-testid='kpi-strip' on the root container (expanded mode)", () => {
    render(
      <KPIStrip
        kpis={{
          range: "This week · Mon — Wed",
          tiles: [{ label: "leads", value: 27 }],
          roi: {
            degraded: true,
            degradedHint: "",
            label: "cost per booked",
            comparator: { value: "—", target: "—" },
          },
        }}
      />,
    );
    expect(screen.getByTestId("kpi-strip")).toBeInTheDocument();
  });

  it("exposes data-testid='kpi-strip' on the root container (collapsed mode)", () => {
    render(
      <KPIStrip
        collapsed
        kpis={{
          range: "This week · Mon — Wed",
          tiles: [{ label: "leads", value: 27 }],
          roi: {
            degraded: true,
            degradedHint: "",
            label: "cost per booked",
            comparator: { value: "—", target: "—" },
          },
        }}
      />,
    );
    expect(screen.getByTestId("kpi-strip")).toBeInTheDocument();
  });
});
