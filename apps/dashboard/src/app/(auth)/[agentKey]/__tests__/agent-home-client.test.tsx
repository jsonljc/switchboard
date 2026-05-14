import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  }),
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

vi.mock("@/hooks/use-agent-pipeline", () => ({
  useAgentPipeline: () => ({
    data: {
      agentKey: "alex",
      pipelineKind: "leads",
      countNoun: "people",
      totalCount: 0,
      tiles: [],
      setupLink: { kind: "agent-setup", agentKey: "alex" },
      freshness: {
        generatedAt: new Date().toISOString(),
        window: "today",
        dataSource: "live",
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: () => ({
    data: {
      hero: { kind: "tours-booked", value: 0, comparator: { window: "week", value: 0 } },
      heroSubProseSegments: [{ kind: "text", text: "Flat vs last week." }],
      spark: [
        { label: "Mon", value: 0 },
        { label: "Tue", value: 0, isProjection: true },
      ],
      stats: [
        { label: "Leads", display: "0", rawValue: 0, unit: "count" },
        { label: "Conversion", display: "0%", rawValue: 0, unit: "percent" },
        { label: "Spend", display: "—", rawValue: null, unit: "currency", unavailable: true },
      ],
      freshness: {
        generatedAt: "2026-05-07T00:00:00Z",
        window: "week",
        dataSource: "live",
        unavailableSources: ["ad-platform-spend"],
      },
      folioRange: "Mon — Tue",
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

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({
    data: {
      variant: "named-lead" as const,
      segments: [
        { kind: "text" as const, text: "Three leads are waiting on you. " },
        { kind: "accent" as const, text: "Maya" },
        { kind: "text" as const, text: " is the one I'd answer first." },
      ],
      signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
      freshness: {
        generatedAt: "2026-05-07T00:00:00Z",
        window: "today" as const,
        dataSource: "live" as const,
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, setHalted: vi.fn(), toggleHalt: vi.fn() }),
}));

vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({ data: { approvals: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-activity", () => ({
  useAgentActivity: () => ({ data: { roster: [], states: [], actions: [] }, isLoading: false }),
}));

import { AgentHomeClient } from "../agent-home-client";

describe("AgentHomeClient", () => {
  it("renders the cockpit when agentKey is 'alex'", () => {
    render(<AgentHomeClient agentKey="alex" />);
    // Cockpit renders both Topbar tab "Alex" AND Identity name "Alex"
    expect(screen.getAllByText("Alex").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("IDLE")).toBeInTheDocument();
  });

  it("renders all 5 block sections for riley", () => {
    render(<AgentHomeClient agentKey="riley" />);
    expect(screen.getByTestId("block-greeting")).toBeInTheDocument();
    expect(screen.getByTestId("block-needs-you")).toBeInTheDocument();
    expect(screen.getByTestId("block-wins")).toBeInTheDocument();
    expect(screen.getByTestId("block-metrics")).toBeInTheDocument();
    expect(screen.getByTestId("block-pipeline")).toBeInTheDocument();
  });

  it("renders all 5 block sections for riley (pipeline check)", () => {
    render(<AgentHomeClient agentKey="riley" />);
    expect(screen.getAllByText(/Pipeline/).length).toBeGreaterThan(0);
  });
});
