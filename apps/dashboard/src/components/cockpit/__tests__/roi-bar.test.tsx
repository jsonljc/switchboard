// apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROIBar } from "../roi-bar";
import type { RoiBar } from "../types";

const fullRoi: RoiBar = {
  label: "return on spend",
  leftMeta: "$214 spent",
  rightMeta: { value: "$1,611", suffix: " in tour value" },
  fillPct: 75,
  breakEvenPct: 16.67,
  breakEvenLabel: "break-even",
  scaleLeft: "$0",
  scaleRight: "6× spend",
  comparator: { value: "$24 per booking", target: "target $30", onTarget: true },
};

describe("<ROIBar>", () => {
  it("renders full variant — label, scales, comparator, fill bar", () => {
    render(<ROIBar roi={fullRoi} />);
    expect(screen.getByText(/return on spend/i)).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("6× spend")).toBeInTheDocument();
    expect(screen.getByText(/\$24 per booking/)).toBeInTheDocument();
    expect(screen.getByText(/target \$30/)).toBeInTheDocument();
    expect(screen.getByTestId("roi-bar-fill")).toHaveStyle({ width: "75%" });
  });

  it("clamps fillPct under 0 and over 100", () => {
    const { rerender } = render(<ROIBar roi={{ ...fullRoi, fillPct: -10 }} />);
    expect(screen.getByTestId("roi-bar-fill")).toHaveStyle({ width: "0%" });
    rerender(<ROIBar roi={{ ...fullRoi, fillPct: 150 }} />);
    expect(screen.getByTestId("roi-bar-fill")).toHaveStyle({ width: "100%" });
  });

  it("renders break-even tick at the configured percent", () => {
    render(<ROIBar roi={fullRoi} />);
    const tick = screen.getByTestId("roi-bar-break-even");
    expect(tick).toBeInTheDocument();
    // breakEvenPct 16.67 → left ~16.67%
    expect((tick.getAttribute("style") ?? "").replace(/\s/g, "")).toContain("left:16.67%");
  });

  it("renders degraded variant with Meta Ads hint", () => {
    render(
      <ROIBar
        roi={{
          degraded: true,
          degradedHint: "Connect Meta Ads to see return on spend",
          label: "return on spend",
          comparator: { value: "—", target: "target $30" },
        }}
      />,
    );
    expect(screen.getByText(/Connect Meta Ads to see return on spend/i)).toBeInTheDocument();
    expect(screen.queryByTestId("roi-bar-fill")).not.toBeInTheDocument();
  });

  it("renders degraded variant with Set-avg-value hint", () => {
    render(
      <ROIBar
        roi={{
          degraded: true,
          degradedHint: "Set average booking value to see return on spend",
          label: "return on spend",
          comparator: { value: "$24 per booking", target: "target $30" },
        }}
      />,
    );
    expect(screen.getByText(/Set average booking value/i)).toBeInTheDocument();
    expect(screen.queryByTestId("roi-bar-fill")).not.toBeInTheDocument();
  });

  it("comparator pill marks onTarget=true via data attribute", () => {
    render(<ROIBar roi={fullRoi} />);
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveAttribute("data-on-target", "true");
  });

  it("comparator pill marks onTarget=false via data attribute", () => {
    render(<ROIBar roi={{ ...fullRoi, comparator: { ...fullRoi.comparator, onTarget: false } }} />);
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveAttribute("data-on-target", "false");
  });
});
