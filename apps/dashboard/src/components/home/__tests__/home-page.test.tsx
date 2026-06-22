import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";
import type { GreetingViewModel } from "@/lib/agent-home/types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import type { ActivityRow } from "@/components/cockpit/types";
import type { AgentRosterEntry, DerivedAgentStateEntry } from "@/lib/api-client-types";

// ── Mutable mock state (house pattern: flip per test in beforeEach/body) ──────

interface FeedState {
  data?: { decisions: Decision[]; counts: { total: number; approval: number; handoff: number } };
  isLoading: boolean;
  isError: boolean;
}
let decisionFeedState: FeedState = { data: undefined, isLoading: false, isError: false };

interface GreetingState {
  data?: GreetingViewModel;
  isLoading: boolean;
  isError: boolean;
}
let alexGreetingState: GreetingState = { data: undefined, isLoading: false, isError: false };
let rileyGreetingState: GreetingState = { data: undefined, isLoading: false, isError: false };

let rosterState: { data?: { roster: AgentRosterEntry[] }; isError: boolean } = {
  data: { roster: [] },
  isError: false,
};
// /api/agents/state returns DerivedAgentStateEntry rows keyed by agentRole
// (alex = "responder", riley = "optimizer"; Mira has no row). Default: Alex is
// genuinely working, Riley idle — so per-agent attribution is exercised (and the
// honest working-count is 1, not "all set-up agents").
function makeStateEntry(
  agentRole: string,
  activityStatus: DerivedAgentStateEntry["activityStatus"],
): DerivedAgentStateEntry {
  return {
    agentRole,
    activityStatus,
    currentTask: null,
    lastActionAt: null,
    lastActionSummary: null,
    metrics: { actionsToday: 0 },
  };
}
const DEFAULT_AGENT_STATES: DerivedAgentStateEntry[] = [
  makeStateEntry("responder", "working"),
  makeStateEntry("optimizer", "idle"),
];
let agentStateState: { data?: { states: DerivedAgentStateEntry[] }; isError: boolean } = {
  data: { states: DEFAULT_AGENT_STATES },
  isError: false,
};

let metricsState: { data?: MetricsViewModelWire; isError: boolean; error: Error | null } = {
  data: undefined,
  isError: false,
  error: null,
};

let activityState: { data?: { rows: ActivityRow[] }; isError: boolean } = {
  data: { rows: [] },
  isError: false,
};

let missionState: { data?: MissionAggregatorResponse; isError: boolean } = {
  data: undefined,
  isError: false,
};

let governanceState: { data?: { haltedAt: string | null } } = { data: { haltedAt: null } };

let sessionState: { data?: { user?: { name?: string | null } } | null } = {
  data: { user: { name: "Dana Lopez" } },
};

const pushMock = vi.fn();
const toastMock = vi.fn();
const primaryMock = vi.fn(() => Promise.resolve({}));
const dismissMock = vi.fn(() => Promise.resolve({}));
const undoMock = vi.fn(() => Promise.resolve({}));

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => decisionFeedState,
}));
vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: (key: string) => (key === "alex" ? alexGreetingState : rileyGreetingState),
}));
vi.mock("@/hooks/use-agents", () => ({
  useAgentRoster: () => rosterState,
  useAgentState: () => agentStateState,
}));
vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: () => metricsState,
}));
vi.mock("@/hooks/use-agent-activity-cockpit", () => ({
  useAgentActivityCockpit: () => activityState,
}));
vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => missionState,
}));
vi.mock("@/hooks/use-governance", () => ({
  useGovernanceStatus: () => governanceState,
}));
vi.mock("@/hooks/use-recommendation-action", () => ({
  useRecommendationAction: () => ({
    primary: primaryMock,
    secondary: vi.fn(() => Promise.resolve({})),
    dismiss: dismissMock,
    confirm: vi.fn(() => Promise.resolve({})),
    undo: undoMock,
    isPending: false,
    error: null,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
}));
// Minimal valid HomeSummary so HomeKpiStrip renders its <section aria-label="This week">
// rather than the error panel (which triggers when data is undefined + isLoading is false).
const HOME_SUMMARY_DATA = {
  attributedValueCents: { state: "empty" as const, reason: "no_current_week_bookings" as const },
  bookings: { state: "empty" as const, reason: "no_current_week_bookings" as const },
  currency: "SGD" as const,
  generatedAt: "2026-06-20T00:00:00.000Z",
};
vi.mock("@/hooks/use-home-summary", () => ({
  useHomeSummary: () => ({
    data: HOME_SUMMARY_DATA,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// AgentPanel is a self-contained sheet tested independently in agent-panel.test.tsx.
// Mock it here so the Home wiring test focuses on the open-state toggle, not
// the deep Radix/sprite render tree. Buttons for onSeeAll / onOpenDecision are
// rendered so tests can verify the route-out callbacks are wired correctly.
vi.mock("@/components/agent-panel/agent-panel", () => ({
  AgentPanel: ({
    agentKey,
    open,
    onSeeAll,
    onOpenDecision,
    onActivate,
  }: {
    agentKey: string;
    open: boolean;
    onOpenChange: () => void;
    onSeeAll?: () => void;
    onOpenDecision?: () => void;
    onActivate?: () => void;
  }) =>
    open ? (
      <div role="dialog" data-testid={`mock-agent-panel-${agentKey}`}>
        <button onClick={onSeeAll} data-testid="mock-see-all">
          See all
        </button>
        <button onClick={onOpenDecision} data-testid="mock-open-decision">
          Open decision
        </button>
        <button onClick={onActivate} data-testid="mock-activate">
          Activate
        </button>
      </div>
    ) : null,
}));

import { fireEvent } from "@testing-library/react";
import { HomePage } from "../home-page";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Yes, send it",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 80,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { contactName: "Maya R." },
    ...overrides,
  };
}

function makeGreeting(inboxCount: number, oldestHours: number | null): GreetingViewModel {
  return {
    variant: "busy",
    segments: [],
    signal: {
      inboxCount,
      oldestOpenItemAgeHours: oldestHours,
      hoursSinceLastOperatorAction: null,
    },
    freshness: { generatedAt: new Date().toISOString(), window: "week", dataSource: "live" },
  };
}

/** Minimal mission whose core setup row drives coreSetupIncomplete (setUp). */
function makeMission(coreDone: boolean): MissionAggregatorResponse {
  return {
    agentKey: "alex",
    displayName: "Alex",
    mission: { role: "", pipeline: "", brand: "", channels: [], rules: null },
    composerPlaceholder: "",
    commands: [],
    targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    setup: [{ key: "inbox", primary: true, done: coreDone }],
  };
}

const METRICS: MetricsViewModelWire = {
  hero: { kind: "appointments-booked", value: 7, comparator: { window: "week", value: 5 } },
  heroSubProseSegments: [],
  spark: [],
  stats: [
    { label: "a", display: "1", rawValue: 1, unit: "count" },
    { label: "b", display: "2", rawValue: 2, unit: "count" },
    { label: "c", display: "3", rawValue: 3, unit: "count" },
  ],
  freshness: { generatedAt: new Date().toISOString(), window: "week", dataSource: "live" },
  folioRange: "Mon → today",
  targets: { avgValueCents: 50000, targetCpbCents: 4000 },
  spendCents: 120000,
  leads: 24,
  qualifiedPct: 60,
  bookedDelta: "+2",
  leadsDelta: "+5",
  qualifiedDelta: "+3",
};

// Stable list of the Home module aria-labels in their canonical DOM presence.
// WorkInProgress was removed from the home layout (replaced by HomeKpiStrip as hero).
const MODULE_LABELS = ["verdict", "Needs you", "This week note", "While you slept"];

/** Returns the module aria-labels present, in document order. */
function modulesInOrder(container: HTMLElement): string[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("[aria-label]"));
  return nodes
    .map((n) => n.getAttribute("aria-label") ?? "")
    .filter((label) => MODULE_LABELS.includes(label));
}

function resetState() {
  decisionFeedState = { data: undefined, isLoading: false, isError: false };
  alexGreetingState = { data: undefined, isLoading: false, isError: false };
  rileyGreetingState = { data: undefined, isLoading: false, isError: false };
  rosterState = { data: { roster: [] }, isError: false };
  agentStateState = { data: { states: DEFAULT_AGENT_STATES }, isError: false };
  metricsState = { data: undefined, isError: false, error: null };
  activityState = { data: { rows: [] }, isError: false };
  missionState = { data: undefined, isError: false };
  governanceState = { data: { haltedAt: null } };
  sessionState = { data: { user: { name: "Dana Lopez" } } };
  pushMock.mockClear();
  toastMock.mockClear();
  primaryMock.mockClear();
  dismissMock.mockClear();
  undoMock.mockClear();
}

describe("HomePage", () => {
  beforeEach(() => {
    resetState();
  });

  it("renders the ACTIVE order with decisions + full data", () => {
    decisionFeedState = {
      data: {
        decisions: [makeDecision({ id: "d1" }), makeDecision({ id: "d2" })],
        counts: { total: 2, approval: 2, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
    alexGreetingState = { data: makeGreeting(3, 2), isLoading: false, isError: false };
    rileyGreetingState = { data: makeGreeting(1, 1), isLoading: false, isError: false };
    metricsState = { data: METRICS, isError: false, error: null };
    activityState = {
      data: { rows: [{ time: "06:14", kind: "booked", head: "Booked Maya for Friday" }] },
      isError: false,
    };

    const { container } = render(<HomePage />);

    // ACTIVE order: Verdict, Needs You, (Team Band), This Week, While You Slept
    // WorkInProgress was removed from the layout.
    expect(modulesInOrder(container)).toEqual([
      "verdict",
      "Needs you",
      "This week note",
      "While you slept",
    ]);

    // Team Band sits ABOVE the bento (audit H3): the crew band reads as a
    // full-width poster between the Verdict and the decision queue, so an agent
    // tile comes AFTER the verdict landmark and BEFORE the Needs You landmark.
    const verdict = screen.getByLabelText("verdict");
    const teamTile = screen.getByTestId("team-mate-alex");
    const needsYou = screen.getByLabelText("Needs you");
    expect(
      verdict.compareDocumentPosition(teamTile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      teamTile.compareDocumentPosition(needsYou) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the CALM order with zero decisions — Needs You absent, This Week before Team Band", () => {
    decisionFeedState = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    alexGreetingState = { data: makeGreeting(0, null), isLoading: false, isError: false };
    rileyGreetingState = { data: makeGreeting(0, null), isLoading: false, isError: false };
    metricsState = { data: METRICS, isError: false, error: null };

    const { container } = render(<HomePage />);

    // Needs You must be absent.
    expect(screen.queryByLabelText("Needs you")).not.toBeInTheDocument();

    // CALM order: Verdict, This Week (promoted), then Team Band below.
    // WorkInProgress was removed from the layout.
    expect(modulesInOrder(container)).toEqual(["verdict", "This week note", "While you slept"]);

    // Team Band is above the bento now (audit H3), so an agent tile comes
    // BEFORE the This Week landmark even in the calm (This-Week-promoted) layout.
    const teamTile = screen.getByTestId("team-mate-alex");
    const thisWeek = screen.getByLabelText("This week note");
    expect(
      teamTile.compareDocumentPosition(thisWeek) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Verdict shows the calm all-clear.
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
  });

  it("degrades independently — metrics error shows This Week skeleton, rest still renders", () => {
    decisionFeedState = {
      data: {
        decisions: [makeDecision({ id: "d1" })],
        counts: { total: 1, approval: 1, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
    alexGreetingState = { data: makeGreeting(2, 1), isLoading: false, isError: false };
    rileyGreetingState = { data: makeGreeting(0, null), isLoading: false, isError: false };
    // Metrics hook errors — This Week must fall back to its skeleton, not crash.
    metricsState = { data: undefined, isError: true, error: new Error("503") };

    expect(() => render(<HomePage />)).not.toThrow();

    // Verdict, Needs You, Team Band all present despite the metrics failure.
    expect(screen.getByLabelText("verdict")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs you")).toBeInTheDocument();
    expect(screen.getByTestId("team-mate-alex")).toBeInTheDocument();

    // This Week renders its skeleton copy (no fabricated numbers).
    expect(screen.getByText(/still being tallied/i)).toBeInTheDocument();
  });

  it("shows the honest Verdict fallback when the decision feed is unavailable", () => {
    decisionFeedState = { data: undefined, isLoading: false, isError: true };

    render(<HomePage />);

    // Fallback verdict line + honest proof.
    expect(screen.getByText(/on shift/i)).toBeInTheDocument();
    expect(screen.getByText(/don't have a read/i)).toBeInTheDocument();
    // Calm/active lines must NOT appear.
    expect(screen.queryByText(/All caught up/i)).not.toBeInTheDocument();
  });

  it("roster/agentState error while feed is available → ACTIVE verdict shape, proof has no 'working' clause", () => {
    // Feed is live with 1 decision.
    decisionFeedState = {
      data: {
        decisions: [makeDecision({ id: "d1" })],
        counts: { total: 1, approval: 1, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
    alexGreetingState = { data: makeGreeting(2, 1), isLoading: false, isError: false };
    // Both roster and agentState fail.
    rosterState = { data: undefined, isError: true };
    agentStateState = { data: undefined, isError: true };

    render(<HomePage />);

    // Verdict must be ACTIVE (not fallback) — feed is available.
    expect(screen.queryByText(/on shift/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/don't have a read/i)).not.toBeInTheDocument();
    // Active verdict shape: the verdict landmark exists and the fallback copy is absent.
    const verdictEl = screen.getByLabelText("verdict");
    expect(verdictEl).toBeInTheDocument();
    // Active proof line must be present (open leads) but must NOT contain "working".
    expect(verdictEl.textContent).toMatch(/open leads/i);
    expect(verdictEl.textContent).not.toMatch(/working/i);
  });

  it("agent-state unavailable → no 'Working' status and no breathing avatar (honest floor)", () => {
    // Feed is live so the page renders the ACTIVE layout, and mission reports the
    // core complete so agents are genuinely set up — but /api/agents/state is
    // unavailable. statusForAgent must return "idle" for every agent, so NO tile
    // shows "Working" and NO avatar breathes (data-playing="true").
    decisionFeedState = {
      data: {
        decisions: [makeDecision({ id: "d1" })],
        counts: { total: 1, approval: 1, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
    missionState = { data: makeMission(true), isError: false };
    agentStateState = { data: undefined, isError: true };

    const { container } = render(<HomePage />);

    expect(container.querySelector('[data-playing="true"]')).toBeNull();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("auto-opens the agent panel for a deep-linked initialAgent (no interaction)", () => {
    // /?agent=alex deep-link → server passes initialAgent → panel is open on mount.
    render(<HomePage initialAgent="alex" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
  });

  it("does not open any panel when initialAgent is absent or null", () => {
    render(<HomePage initialAgent={null} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking a Team Band tile opens the agent panel for that agent", () => {
    // Panel is absent before interaction.
    render(<HomePage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Click the alex tile → panel should appear.
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
  });

  it("clicking the mira tile opens the agent panel for mira (honest not-set-up panel)", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByTestId("team-mate-mira"));
    expect(screen.getByTestId("mock-agent-panel-mira")).toBeInTheDocument();
  });

  it("swapping agents — clicking riley after alex shows riley panel and removes alex panel", () => {
    render(<HomePage />);

    // Open alex panel first.
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-agent-panel-riley")).not.toBeInTheDocument();

    // Click riley tile → riley panel appears, alex panel is gone.
    fireEvent.click(screen.getByTestId("team-mate-riley"));
    expect(screen.getByTestId("mock-agent-panel-riley")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-agent-panel-alex")).not.toBeInTheDocument();
  });

  it("onSeeAll callback navigates to /results", () => {
    render(<HomePage />);

    // Open a panel first.
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();

    // Trigger the See All button wired to onSeeAll.
    fireEvent.click(screen.getByTestId("mock-see-all"));
    expect(pushMock).toHaveBeenCalledWith("/results");
  });

  it("onOpenDecision callback navigates to /inbox", () => {
    render(<HomePage />);

    // Open a panel first.
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();

    // Trigger the Open Decision button wired to onOpenDecision.
    fireEvent.click(screen.getByTestId("mock-open-decision"));
    expect(pushMock).toHaveBeenCalledWith("/inbox");
  });

  it("onActivate callback navigates to /settings/channels", () => {
    render(<HomePage />);

    // Open a panel first.
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();

    // Trigger the Activate button wired to onActivate.
    fireEvent.click(screen.getByTestId("mock-activate"));
    expect(pushMock).toHaveBeenCalledWith("/settings/channels");
  });

  it("Team Band setUp reflects real mission enablement, not static launchTier", () => {
    // Mission reports the core channel NOT connected → agents are honestly
    // "Not set up", even though launchTier marks alex/riley day-one. The old
    // static launchTier read would have shown them set up.
    missionState = { data: makeMission(false), isError: false };

    render(<HomePage />);

    expect(screen.getByTestId("team-mate-alex")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("team-mate-riley")).toHaveAttribute("data-disabled", "true");
  });

  it("Team Band shows agents set up when the mission core is complete", () => {
    missionState = { data: makeMission(true), isError: false };

    render(<HomePage />);

    expect(screen.getByTestId("team-mate-alex")).toHaveAttribute("data-disabled", "false");
    expect(screen.getByTestId("team-mate-riley")).toHaveAttribute("data-disabled", "false");
  });

  it("falls back to launchTier when mission is unavailable (no fabricated 'Not set up')", () => {
    // Mission errored → don't flip to a transient "Not set up"; use launchTier.
    missionState = { data: undefined, isError: true };

    render(<HomePage />);

    // alex/riley day-one → set up via fallback; mira day-thirty → not set up.
    expect(screen.getByTestId("team-mate-alex")).toHaveAttribute("data-disabled", "false");
    expect(screen.getByTestId("team-mate-mira")).toHaveAttribute("data-disabled", "true");
  });

  it("mounts the hero KPI strip and no longer renders WorkInProgress", () => {
    render(<HomePage />);
    expect(screen.getByLabelText("This week")).toBeInTheDocument(); // the strip section
    expect(screen.queryByText(/Work in progress/i)).toBeNull();
  });
});
