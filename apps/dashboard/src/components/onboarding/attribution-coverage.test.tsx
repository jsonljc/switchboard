import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttributionCoverage } from "./attribution-coverage";

describe("AttributionCoverage", () => {
  it("shows coverage percentage and per-source state", () => {
    render(
      <AttributionCoverage
        coveragePct={0.65}
        bySource={{
          ctwa: { campaigns: 2, spend: 400, tracking: "verified" },
          instant_form: { campaigns: 1, spend: 100, tracking: "no_recent_traffic" },
          web: { campaigns: 1, spend: 270, tracking: "v2_pending" },
        }}
      />,
    );
    expect(screen.getByText(/65%/)).toBeInTheDocument();
    expect(screen.getByText(/Verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Coming in v2/i)).toBeInTheDocument();
  });
});
