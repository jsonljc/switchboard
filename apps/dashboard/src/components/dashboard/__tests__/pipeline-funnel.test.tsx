import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineFunnel } from "../pipeline-funnel";
import type { PipelineSnapshot } from "@/hooks/use-pipeline";

const MOCK_SNAPSHOT: PipelineSnapshot = {
  organizationId: "org-1",
  stages: [
    { stage: "interested", count: 12, totalValue: 600000 },
    { stage: "qualified", count: 8, totalValue: 450000 },
    { stage: "quoted", count: 5, totalValue: 320000 },
    { stage: "booked", count: 4, totalValue: 280000 },
    { stage: "showed", count: 3, totalValue: 150000 },
    { stage: "won", count: 2, totalValue: 120000 },
    { stage: "lost", count: 4, totalValue: 0 },
    { stage: "nurturing", count: 2, totalValue: 0 },
  ],
  totalContacts: 40,
  totalRevenue: 120000,
  generatedAt: "2026-03-27T10:00:00Z",
};

describe("PipelineFunnel", () => {
  it("renders all 6 funnel stages with counts and values", () => {
    render(<PipelineFunnel data={MOCK_SNAPSHOT} isLoading={false} isError={false} />);

    expect(screen.getByText("Your pipeline")).toBeDefined();
    expect(screen.getByText("Interested")).toBeDefined();
    expect(screen.getByText("Qualified")).toBeDefined();
    expect(screen.getByText("Quoted")).toBeDefined();
    expect(screen.getByText("Booked")).toBeDefined();
    expect(screen.getByText("Showed")).toBeDefined();
    expect(screen.getByText("Won")).toBeDefined();

    // Counts
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("8")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();

    // Currency values
    expect(screen.getByText("$6,000")).toBeDefined();
    expect(screen.getByText("$1,200")).toBeDefined();
  });

  it("renders lost and nurturing summary", () => {
    render(<PipelineFunnel data={MOCK_SNAPSHOT} isLoading={false} isError={false} />);

    expect(screen.getByText(/4 lost/)).toBeDefined();
    expect(screen.getByText(/2 nurturing/)).toBeDefined();
  });

  it("renders loading skeleton", () => {
    const { container } = render(
      <PipelineFunnel data={undefined} isLoading={true} isError={false} />,
    );

    expect(screen.getByText("Your pipeline")).toBeDefined();
    const pulsingBars = container.querySelectorAll(".animate-pulse");
    expect(pulsingBars.length).toBeGreaterThan(0);
  });

  it("renders empty state when no stages", () => {
    const emptyData: PipelineSnapshot = {
      ...MOCK_SNAPSHOT,
      stages: [],
    };
    render(<PipelineFunnel data={emptyData} isLoading={false} isError={false} />);

    expect(screen.getByText("No leads in your pipeline yet")).toBeDefined();
  });

  it("renders nothing on error", () => {
    const { container } = render(
      <PipelineFunnel data={undefined} isLoading={false} isError={true} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("handles missing lost/nurturing gracefully", () => {
    const dataWithoutLost: PipelineSnapshot = {
      ...MOCK_SNAPSHOT,
      stages: MOCK_SNAPSHOT.stages.filter((s) => s.stage !== "lost" && s.stage !== "nurturing"),
    };
    render(<PipelineFunnel data={dataWithoutLost} isLoading={false} isError={false} />);

    expect(screen.getByText("Interested")).toBeDefined();
    expect(screen.queryByText(/lost/)).toBeNull();
    expect(screen.queryByText(/nurturing/)).toBeNull();
  });
});
