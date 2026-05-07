import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  }),
  useInboxCount: () => 0,
}));

vi.mock("@/hooks/use-agent-wins", () => ({
  useAgentWins: () => ({
    data: {
      wins: [],
      hasMore: false,
      freshness: { generatedAt: "2026-05-07T00:00:00Z", window: "today", dataSource: "live" },
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
  useTenantContext: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

import { AgentHomeClient } from "../agent-home-client";

describe("AgentHomeClient", () => {
  it("renders all 5 block sections for alex", () => {
    render(<AgentHomeClient agentKey="alex" />);
    expect(screen.getByTestId("block-greeting")).toBeInTheDocument();
    expect(screen.getByTestId("block-needs-you")).toBeInTheDocument();
    expect(screen.getByTestId("block-wins")).toBeInTheDocument();
    expect(screen.getByTestId("block-metrics")).toBeInTheDocument();
    expect(screen.getByTestId("block-pipeline")).toBeInTheDocument();
  });

  it("renders all 5 block sections for riley", () => {
    render(<AgentHomeClient agentKey="riley" />);
    expect(screen.getAllByText(/Pipeline/).length).toBeGreaterThan(0);
  });
});
