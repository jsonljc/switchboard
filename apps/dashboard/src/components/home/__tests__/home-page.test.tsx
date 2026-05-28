import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";
import type { GreetingViewModel } from "@/lib/agent-home/types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import type { ActivityRow } from "@/components/cockpit/types";
import type { AgentRosterEntry, AgentStateEntry } from "@/lib/api-client-types";

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
let agentStateState: { data?: { states: AgentStateEntry[] }; isError: boolean } = {
  data: { states: [] },
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

// AgentPanel is a self-contained sheet tested independently in agent-panel.test.tsx.
// Mock it here so the Home wiring test focuses on the open-state toggle, not
// the deep Radix/sprite render tree.
vi.mock("@/components/agent-panel/agent-panel", () => ({
  AgentPanel: ({
    agentKey,
    open,
  }: {
    agentKey: string;
    open: boolean;
    onOpenChange: () => void;
  }) => (open ? <div role="dialog" data-testid={`mock-agent-panel-${agentKey}`} /> : null),
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

const METRICS: MetricsViewModelWire = {
  hero: { kind: "tours-booked", value: 7, comparator: { window: "week", value: 5 } },
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
const MODULE_LABELS = [
  "verdict",
  "Needs you",
  "This week note",
  "While you slept",
  "Work in progress",
];

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
  agentStateState = { data: { states: [] }, isError: false };
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

    // ACTIVE order: Verdict, Needs You, (Team Pulse), This Week, While You Slept, Work in Progress
    expect(modulesInOrder(container)).toEqual([
      "verdict",
      "Needs you",
      "This week note",
      "While you slept",
      "Work in progress",
    ]);

    // Team Pulse sits between Needs You and This Week — assert via the chip ribbon
    // position relative to the Needs You and This Week landmarks.
    const needsYou = screen.getByLabelText("Needs you");
    const teamChip = screen.getByTestId("agent-chip-alex");
    const thisWeek = screen.getByLabelText("This week note");
    expect(
      needsYou.compareDocumentPosition(teamChip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      teamChip.compareDocumentPosition(thisWeek) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the CALM order with zero decisions — Needs You absent, This Week before Team Pulse", () => {
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

    // CALM order: Verdict, This Week (promoted), then Team Pulse below.
    expect(modulesInOrder(container)).toEqual([
      "verdict",
      "This week note",
      "While you slept",
      "Work in progress",
    ]);

    // This Week appears BEFORE Team Pulse (promoted).
    const thisWeek = screen.getByLabelText("This week note");
    const teamChip = screen.getByTestId("agent-chip-alex");
    expect(
      thisWeek.compareDocumentPosition(teamChip) & Node.DOCUMENT_POSITION_FOLLOWING,
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

    // Verdict, Needs You, Team Pulse all present despite the metrics failure.
    expect(screen.getByLabelText("verdict")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs you")).toBeInTheDocument();
    expect(screen.getByTestId("agent-chip-alex")).toBeInTheDocument();

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

  it("clicking a Team Pulse chip opens the agent panel for that agent", () => {
    // Panel is absent before interaction.
    render(<HomePage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Click the alex chip → panel should appear.
    fireEvent.click(screen.getByTestId("agent-chip-alex"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
  });

  it("clicking the mira chip opens the agent panel for mira (honest not-set-up panel)", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByTestId("agent-chip-mira"));
    expect(screen.getByTestId("mock-agent-panel-mira")).toBeInTheDocument();
  });
});
