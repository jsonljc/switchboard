import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsYouBlock } from "../needs-you-block";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  }),
}));

describe("NeedsYouBlock", () => {
  it("renders empty-state when there are no decisions", () => {
    render(<NeedsYouBlock agentKey="alex" />);
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it("renders the Needs you folio header", () => {
    render(<NeedsYouBlock agentKey="alex" />);
    expect(screen.getByText("Needs you")).toBeInTheDocument();
  });
});
