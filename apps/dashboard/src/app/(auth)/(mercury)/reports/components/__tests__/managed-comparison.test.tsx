import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManagedComparison } from "../managed-comparison";
import type { ManagedComparisonData } from "@switchboard/schemas";

const full: ManagedComparisonData = {
  source: "in-period-cohort",
  ads: {
    managed: { spend: 2112, revenue: 14720, roas: 6.97 },
    unmanaged: { spend: 1840, revenue: 6420, roas: 3.49 },
    delta: { kind: "pos", text: "↑ 99% roas" },
  },
  conversations: {
    managed: { spend: 0, replies: 312, conversionRate: 0.221, replyMinutesP50: 4 },
    unmanaged: { spend: 0, replies: 156, conversionRate: 0.092, replyMinutesP50: 47 },
    delta: { kind: "pos", text: "↑ 140% conv" },
  },
};

describe("ManagedComparison", () => {
  it("renders both columns when both pairs are populated", () => {
    render(<ManagedComparison data={full} />);
    expect(screen.getByText("Ads")).toBeInTheDocument();
    expect(screen.getByText("Conversations")).toBeInTheDocument();
  });

  it("uses 'How you're doing with us vs. without' eyebrow", () => {
    render(<ManagedComparison data={full} />);
    expect(screen.getByText(/How you're doing with us vs\. without/i)).toBeInTheDocument();
    expect(screen.queryByText(/Managed vs\. unmanaged/i)).toBeNull();
  });

  it("shows the friendlier source caption", () => {
    render(<ManagedComparison data={full} />);
    expect(screen.getByText(/Compared to similar accounts this period/i)).toBeInTheDocument();
  });

  it("renders only Ads column when conversations is null", () => {
    const data = { ...full, conversations: null };
    render(<ManagedComparison data={data} />);
    expect(screen.getByText("Ads")).toBeInTheDocument();
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("renders only Conversations column when ads is null", () => {
    const data = { ...full, ads: null };
    render(<ManagedComparison data={data} />);
    expect(screen.queryByText("Ads")).toBeNull();
    expect(screen.getByText("Conversations")).toBeInTheDocument();
  });

  it("returns null when both pairs are null and no emptyMessage", () => {
    const data: ManagedComparisonData = {
      source: "in-period-cohort",
      ads: null,
      conversations: null,
    };
    const { container } = render(<ManagedComparison data={data} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders emptyMessage when both pairs are null and emptyMessage is set", () => {
    const data: ManagedComparisonData = {
      source: "in-period-cohort",
      ads: null,
      conversations: null,
      emptyMessage: "Not enough data yet to compare.",
    };
    render(<ManagedComparison data={data} />);
    expect(screen.getByText(/Not enough data yet to compare/)).toBeInTheDocument();
  });

  it("renders 'Compared to your pre-Switchboard baseline' for that source", () => {
    const data = { ...full, source: "pre-switchboard-baseline" as const };
    render(<ManagedComparison data={data} />);
    expect(screen.getByText(/Compared to your pre-Switchboard baseline/i)).toBeInTheDocument();
  });
});
