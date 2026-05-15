// apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import type { ActivityRow } from "@/components/cockpit/types";

// Mock data hooks before importing the page.
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({
    data: { approvals: pendingApprovalsData },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-agent-activity-cockpit", () => ({
  useAgentActivityCockpit: () => ({ data: { rows: activityRowsData }, isLoading: false }),
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
let activityRowsData: ActivityRow[] = [];

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
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

const toastMock = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
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
    activityRowsData = [];
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
    // A.5: halted copy now lives as the Composer input placeholder, not as
    // visible <span> text the way ComposerPlaceholder rendered it.
    expect(
      screen.getByPlaceholderText(/Halted — resume to send instructions/i),
    ).toBeInTheDocument();
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
    activityRowsData = [];
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
    activityRowsData = [];
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

describe("CockpitPage — A.4 useAgentActivityCockpit wiring", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
    metricsData = undefined;
    pendingApprovalsData = [];
    activityRowsData = [];
  });

  it("renders activity rows returned by useAgentActivityCockpit", async () => {
    missionData = MISSION_PARTIAL_DONE;
    activityRowsData = [
      {
        time: "11:58",
        kind: "booked",
        head: "Tour booked with Priya S.",
        body: "Confirmed for Thursday 2pm",
        timestampIso: new Date().toISOString(),
      },
    ];
    render(<CockpitPage />);
    expect(await screen.findByText("Tour booked with Priya S.")).toBeInTheDocument();
  });

  it("renders empty activity stream when hook returns no rows", async () => {
    missionData = MISSION_PARTIAL_DONE;
    activityRowsData = [];
    render(<CockpitPage />);
    expect(await screen.findByTestId("cockpit-activity-stream")).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it("derives recentActivityAt from timestampIso of the first row", async () => {
    missionData = MISSION_PARTIAL_DONE;
    // A row with a recent timestampIso drives the WORKING status pill
    const recentIso = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    activityRowsData = [
      {
        time: "11:58",
        kind: "booked",
        head: "Just booked",
        timestampIso: recentIso,
      },
    ];
    render(<CockpitPage />);
    // The status pill should show WORKING (recent activity within 10 min window)
    expect(await screen.findByText("WORKING")).toBeInTheDocument();
  });
});

describe("CockpitPage — A.7a approval sort", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
    metricsData = undefined;
    pendingApprovalsData = [];
    activityRowsData = [];
  });

  it("renders approvals in urgency-then-createdAt order (immediate → this_week, createdAt desc within band)", () => {
    // Intentionally out-of-order in the fixture to verify sorting:
    // - p1 medium/this_week, oldest
    // - p2 critical/immediate, middle
    // - p3 medium/this_week, newest
    // Expected order: [p2 immediate, p3 this_week newest, p1 this_week oldest].
    pendingApprovalsData = [
      {
        id: "p1",
        summary: "old pricing",
        riskCategory: "medium",
        status: "pending",
        envelopeId: "e1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        bindingHash: "h1",
        createdAt: "2026-05-14T00:00:00.000Z",
        agentRosterId: "alex",
      },
      {
        id: "p2",
        summary: "regulatory immediate",
        riskCategory: "critical",
        status: "pending",
        envelopeId: "e2",
        expiresAt: "2099-01-01T00:00:00.000Z",
        bindingHash: "h2",
        createdAt: "2026-05-15T00:00:00.000Z",
        agentRosterId: "alex",
      },
      {
        id: "p3",
        summary: "new pricing",
        riskCategory: "medium",
        status: "pending",
        envelopeId: "e3",
        expiresAt: "2099-01-01T00:00:00.000Z",
        bindingHash: "h3",
        createdAt: "2026-05-15T12:00:00.000Z",
        agentRosterId: "alex",
      },
    ];
    render(<CockpitPage />);
    // Approval titles render in the ApprovalCard <h2> elements.
    const headings = screen.getAllByRole("heading", { level: 2 });
    const titles = headings.map((h) => h.textContent ?? "");
    expect(titles).toEqual(["regulatory immediate", "new pricing", "old pricing"]);
  });
});

describe("CockpitPage — A.5 composer + palette", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    toastMock.mockClear();
    haltedState = false;
    missionData = undefined;
    metricsData = undefined;
    pendingApprovalsData = [];
    activityRowsData = [];
  });

  it("renders the Composer at the bottom of the cockpit (not ComposerPlaceholder)", () => {
    render(<CockpitPage />);
    expect(screen.getByLabelText("Composer input")).toBeInTheDocument();
  });

  it("flips Topbar 'Tell Alex…' from disabled to enabled (paletteEnabled=true)", () => {
    render(<CockpitPage />);
    const button = screen.getByRole("button", { name: /Tell Alex…/i });
    expect(button).not.toBeDisabled();
  });

  it("Topbar 'Tell Alex…' click opens the palette", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<CockpitPage />);
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Tell Alex…/i }));
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
  });

  it("⌘K opens the palette", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<CockpitPage />);
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
  });

  it("Escape closes the palette after opening", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<CockpitPage />);
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
  });

  it("Composer input is disabled when halt is active", () => {
    haltedState = true;
    render(<CockpitPage />);
    const input = screen.getByLabelText("Composer input") as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toMatch(/Halted/);
  });
});
