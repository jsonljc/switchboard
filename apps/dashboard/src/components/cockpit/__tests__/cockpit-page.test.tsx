// apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";

// Mock data hooks before importing the page.
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({
    data: { approvals: pendingApprovalsData },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-agent-activity", () => ({
  useAgentActivity: () => ({ data: { roster: [], states: [], actions: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({ data: null, isLoading: false }),
}));

let metricsData: MetricsViewModelWire | undefined = undefined;

vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: () => ({
    data: metricsData,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

let pendingApprovalsData: unknown[] = [];

const toggleHaltMock = vi.fn();
let haltedState = false;

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({
    halted: haltedState,
    setHalted: vi.fn(),
    toggleHalt: toggleHaltMock,
  }),
}));

let missionData: MissionAggregatorResponse | undefined = undefined;

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({
    data: missionData,
    isLoading: false,
    isError: false,
  }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CockpitPage } from "../cockpit-page";

const FULL_MISSION_ALL_UNDONE: MissionAggregatorResponse = {
  agentKey: "alex",
  displayName: "Alex",
  mission: {
    role: "SDR · qualify inbound leads, book tours",
    pipeline: "Tours pipeline · single funnel",
    brand: "HotPod Yoga · —",
    channels: [],
    rules: null,
  },
  composerPlaceholder: "Tell Alex what to do — coming soon",
  commands: [],
  targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
  setup: [
    { key: "meta", done: false, primary: true },
    { key: "inbox", done: false },
    { key: "cal", done: false },
    { key: "rules", done: false },
  ],
};

const MISSION_PARTIAL_DONE: MissionAggregatorResponse = {
  ...FULL_MISSION_ALL_UNDONE,
  setup: [
    { key: "meta", done: true },
    { key: "inbox", done: false, primary: true },
    { key: "cal", done: false },
    { key: "rules", done: false },
  ],
};

describe("CockpitPage", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
    metricsData = undefined;
    pendingApprovalsData = [];
  });

  it("renders Topbar, Identity, and ActivityStream in the cold state", () => {
    render(<CockpitPage />);
    // Topbar tab "Alex" + Identity name "Alex" = 2 matches
    expect(screen.getAllByText("Alex").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByText("IDLE")).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it("does not render ApprovalBlock when no pending approvals", () => {
    render(<CockpitPage />);
    expect(screen.queryByText(/Alex needs you/i)).not.toBeInTheDocument();
  });

  it("clicking the Halt button calls useHalt().toggleHalt()", () => {
    render(<CockpitPage />);
    fireEvent.click(screen.getByRole("button", { name: /halt/i }));
    expect(toggleHaltMock).toHaveBeenCalledOnce();
  });

  it("renders the HALTED status pill when useHalt() reports halted", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("consumes the existing HaltProvider (does not re-root)", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
  });
});

describe("CockpitPage — A.2 mission + empty-state", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
    metricsData = undefined;
    pendingApprovalsData = [];
  });

  it("makes the subtitle clickable once mission data loads and toggles the popover", async () => {
    missionData = FULL_MISSION_ALL_UNDONE;
    render(<CockpitPage />);
    // The subtitle should be a button when mission data is present.
    const subtitle = await screen.findByRole("button", { name: /SDR/i });
    fireEvent.click(subtitle);
    // The mission popover should open (has role=dialog with aria-label "Alex mission").
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Alex mission/i })).toBeInTheDocument(),
    );
  });

  it("renders EmptyState (and hides activity stream) when setup is all-undone", async () => {
    missionData = FULL_MISSION_ALL_UNDONE;
    render(<CockpitPage />);
    expect(await screen.findByTestId("cockpit-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-activity-stream")).not.toBeInTheDocument();
  });

  it("renders the activity stream (and not EmptyState) when at least one setup row is done", async () => {
    missionData = MISSION_PARTIAL_DONE;
    render(<CockpitPage />);
    expect(await screen.findByTestId("cockpit-activity-stream")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-empty-state")).not.toBeInTheDocument();
  });
});

const STEADY_METRICS: MetricsViewModelWire = {
  hero: { kind: "tours-booked", value: 9, comparator: { window: "week", value: 6 } },
  heroSubProseSegments: [],
  spark: [],
  stats: [
    { label: "Leads", display: "47", rawValue: 47, unit: "count" },
    { label: "Conversion", display: "28%", rawValue: 0.28, unit: "percent" },
    { label: "Spend", display: "$214", rawValue: 21400, unit: "currency" },
  ],
  freshness: { generatedAt: new Date().toISOString(), window: "week", dataSource: "live" },
  folioRange: "May 12 – May 18",
  targets: { avgValueCents: 17900, targetCpbCents: 3000 },
  spendCents: 21400,
  leads: 47,
  qualifiedPct: 28,
  bookedDelta: "+3",
  leadsDelta: "+12",
  qualifiedDelta: "+4 pts",
};

describe("CockpitPage — A.3 KPI strip", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
    metricsData = undefined;
    pendingApprovalsData = [];
  });

  it("renders KPIStrip in steady state (mission partial-done + metrics present)", async () => {
    missionData = MISSION_PARTIAL_DONE;
    metricsData = STEADY_METRICS;
    render(<CockpitPage />);
    expect(await screen.findByText(/bookings/i)).toBeInTheDocument();
    expect(screen.getByText(/leads worked/i)).toBeInTheDocument();
    expect(screen.getByText(/ad spend/i)).toBeInTheDocument();
    expect(screen.getByText(/return on spend/i)).toBeInTheDocument();
  });

  // Pins the eyebrow composition contract: the dashboard prefixes
  // "This week · " to the wire's `folioRange` (whose format is itself
  // pinned at packages/core/src/agent-home/__tests__/metrics-buckets.test.ts).
  // If either side changes its format, this assertion fails — closes the
  // gap flagged in PR #500 review (Important #5).
  it("eyebrow renders as 'This week · {folioRange}' verbatim", async () => {
    missionData = MISSION_PARTIAL_DONE;
    metricsData = { ...STEADY_METRICS, folioRange: "Mon — Wed" };
    render(<CockpitPage />);
    expect(await screen.findByText("This week · Mon — Wed")).toBeInTheDocument();
  });

  it("does not render KPIStrip in cold state (all setup undone)", async () => {
    missionData = FULL_MISSION_ALL_UNDONE;
    metricsData = STEADY_METRICS;
    render(<CockpitPage />);
    expect(await screen.findByTestId("cockpit-empty-state")).toBeInTheDocument();
    expect(screen.queryByText(/leads worked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/return on spend/i)).not.toBeInTheDocument();
  });

  it("does not render KPIStrip when metrics data has not loaded", () => {
    missionData = MISSION_PARTIAL_DONE;
    metricsData = undefined;
    render(<CockpitPage />);
    expect(screen.queryByText(/leads worked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/return on spend/i)).not.toBeInTheDocument();
  });

  it("collapses KPIStrip to single-line headline when there is at least one pending approval", async () => {
    missionData = MISSION_PARTIAL_DONE;
    metricsData = STEADY_METRICS;
    pendingApprovalsData = [
      {
        id: "appr-1",
        bindingHash: "bh-1",
        riskCategory: "medium",
        summary: "Pricing decision",
        createdAt: new Date().toISOString(),
        agentRosterId: "alex",
      },
    ];
    render(<CockpitPage />);
    // ROI bar is hidden in collapsed mode
    await waitFor(() => expect(screen.queryByText(/return on spend/i)).not.toBeInTheDocument());
    // Open Report button is the collapsed signature
    expect(screen.getByRole("button", { name: /Open report/i })).toBeInTheDocument();
  });
});
