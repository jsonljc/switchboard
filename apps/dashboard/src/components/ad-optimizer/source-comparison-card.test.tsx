import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceComparisonCard } from "./source-comparison-card";

describe("SourceComparisonCard", () => {
  it("renders one row per source with formatted metrics", () => {
    render(
      <SourceComparisonCard
        rows={[
          {
            source: "ctwa",
            cpl: 4.1,
            costPerQualified: 13.7,
            costPerBooked: 34.2,
            closeRate: 0.08,
            trueRoas: 1.95,
          },
          {
            source: "instant_form",
            cpl: 1.9,
            costPerQualified: 23.8,
            costPerBooked: 95,
            closeRate: 0.005,
            trueRoas: 0.21,
          },
        ]}
      />,
    );
    expect(screen.getByText("CTWA")).toBeInTheDocument();
    expect(screen.getByText("Instant Form")).toBeInTheDocument();
    expect(screen.getByText("$4.10")).toBeInTheDocument();
    expect(screen.getByText("1.95×")).toBeInTheDocument();
  });

  it("renders em dash for null metrics", () => {
    render(
      <SourceComparisonCard
        rows={[
          {
            source: "instant_form",
            cpl: null,
            costPerQualified: null,
            costPerBooked: null,
            closeRate: null,
            trueRoas: null,
          },
        ]}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
