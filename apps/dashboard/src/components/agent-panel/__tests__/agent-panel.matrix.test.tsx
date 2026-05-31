/**
 * State-matrix integration tests for the assembled AgentPanel.
 *
 * Each test corresponds to one row of the canonical state matrix in
 * docs/superpowers/specs/2026-05-26-agent-panel-design.md.
 *
 * All seven hooks that the four slots call are mocked here so we render
 * the REAL assembled slots (IdentityStatus, KeyResult, OpenDecisions, WorkLog)
 * — not component stubs. This proves the panel composes correctly end-to-end
 * for each scenario.
 *
 * Canonical strings asserted / forbidden are taken directly from the spec's
 * Copy contract and state matrix.
 *
 * One-slot error NEVER blanks others: the "one-slot fetch error" row renders
 * decisions error while identity/hero/work-log still show their real states.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Hook mocks (declared before imports) ─────────────────────────────────────
// All mocks are declared as module-level let so each test can override them
// in beforeEach / per-test.

// -- useAgentGreeting --
let greetingData: unknown = undefined;
let greetingIsLoading = false;
let greetingIsError = false;

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({
    data: greetingData,
    isLoading: greetingIsLoading,
    isError: greetingIsError,
    error: null,
  }),
}));

// -- useAgentState --
let statesData: unknown[] = [];
let stateIsLoading = false;

vi.mock("@/hooks/use-agents", () => ({
  useAgentState: () => ({
    data: { states: statesData },
    isLoading: stateIsLoading,
    isError: false,
    error: null,
  }),
}));

// -- useHalt --
let haltedValue = false;

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({
    halted: haltedValue,
    isPending: false,
    error: null,
    setHalted: vi.fn(),
    toggleHalt: vi.fn(),
  }),
}));

// -- useAgentMetrics --
// window="all" and window="week" are controlled separately.
let allData: unknown = undefined;
let allIsError = false;
let allIsLoading = false;
let weekData: unknown = undefined;
let weekIsError = false;
let weekIsLoading = false;

vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: vi.fn((_agentKey: string, metricWindow: "week" | "all" = "week") => {
    if (metricWindow === "all") {
      return { data: allData, isError: allIsError, isLoading: allIsLoading, error: null };
    }
    return { data: weekData, isError: weekIsError, isLoading: weekIsLoading, error: null };
  }),
}));

// -- useAgentMission --
let missionData: unknown = undefined;
let missionIsLoading = false;

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({
    data: missionData,
    isLoading: missionIsLoading,
    isError: false,
    error: null,
  }),
}));

// -- useDecisionFeed --
let feedData:
  | { decisions: unknown[]; counts: { total: number; approval: number; handoff: number } }
  | undefined = undefined;
let feedIsLoading = false;
let feedIsError = false;

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: feedData,
    isLoading: feedIsLoading,
    isError: feedIsError,
    error: null,
  }),
}));

// -- useAgentActivityCockpit --
let activityData: { rows: unknown[] } | undefined = undefined;
let activityIsLoading = false;
let activityIsError = false;

vi.mock("@/hooks/use-agent-activity-cockpit", () => ({
  useAgentActivityCockpit: () => ({
    data: activityData,
    isLoading: activityIsLoading,
    isError: activityIsError,
    error: null,
  }),
}));

// -- InboxAgentAvatar -- (avoids sprite/canvas setup)
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

// Mock next/navigation and use-mira-enabled so MiraPanel renders in a non-Next env
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-mira-enabled", () => ({
  useMiraEnabled: () => ({ enabled: false, isLoading: false }),
}));

// ── Import component after all mocks ─────────────────────────────────────────
import { AgentPanel } from "@/components/agent-panel/agent-panel";

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeGreeting(
  opts: {
    segments?: Array<{ kind: "text" | "accent"; text: string }>;
    oldestOpenItemAgeHours?: number | null;
  } = {},
) {
  const ageHours = "oldestOpenItemAgeHours" in opts ? opts.oldestOpenItemAgeHours : 2;
  return {
    variant: "named-lead",
    segments: opts.segments ?? [
      { kind: "text", text: "Steady morning — " },
      { kind: "accent", text: "answered every lead" },
    ],
    signal: {
      inboxCount: 3,
      oldestOpenItemAgeHours: ageHours,
      hoursSinceLastOperatorAction: 1,
    },
    freshness: {
      generatedAt: "2026-05-28T12:00:00Z",
      window: "today",
      dataSource: "live",
    },
  };
}

function makeState(agentRole = "responder", lastActionAt = "2026-05-28T11:50:00Z") {
  return {
    agentRole,
    activityStatus: "working",
    lastActionAt,
    currentTask: null,
    lastActionSummary: null,
    metrics: {},
  };
}

function makeMetricsVM(
  opts: {
    kind?: "tours-booked" | "ad-leads" | "creatives-shipped" | "revenue-attributed";
    value?: number;
    spendCents?: number | null;
    targetCpbCents?: number | null;
  } = {},
) {
  return {
    hero: {
      kind: opts.kind ?? "tours-booked",
      value: opts.value ?? 12,
      comparator: {},
    },
    spendCents: opts.spendCents !== undefined ? opts.spendCents : null,
    targets: {
      avgValueCents: null,
      targetCpbCents: opts.targetCpbCents !== undefined ? opts.targetCpbCents : null,
    },
    heroSubProseSegments: [],
    spark: [],
    stats: [
      { label: "l1", value: 0 },
      { label: "l2", value: 0 },
      { label: "l3", value: 0 },
    ],
    freshness: { generatedAt: "2026-05-28T10:00:00Z", window: "week", dataSource: "live" },
    folioRange: "this week",
    leads: 0,
    qualifiedPct: 0,
    bookedDelta: null,
    leadsDelta: null,
    qualifiedDelta: null,
  };
}

function makeMission(
  opts: {
    setupRows?: Array<{ key: string; done: boolean; primary?: boolean }>;
    channels?: Array<{ kind: string; label: string; status: string }>;
    agentKey?: string;
  } = {},
) {
  return {
    agentKey: opts.agentKey ?? "alex",
    displayName: opts.agentKey === "riley" ? "Riley" : "Alex",
    setup: opts.setupRows ?? [{ key: "inbox", done: true, primary: true }],
    mission: {
      role: "assistant",
      pipeline: "crm",
      brand: "Clinic",
      channels: opts.channels ?? [],
      rules: null,
    },
    composerPlaceholder: "",
    commands: [],
    targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
  };
}

function makeDecision(id = "dec-1", humanSummary = "Approve campaign change") {
  return {
    id,
    kind: "approval" as const,
    agentKey: "alex" as const,
    humanSummary,
    presentation: {
      primaryLabel: "Approve",
      secondaryLabel: "Reject",
      dismissLabel: "Skip",
      dataLines: [],
    },
    urgencyScore: 0.8,
    createdAt: "2026-05-28T10:00:00Z",
    threadHref: null,
    sourceRef: { kind: "approval" as const, sourceId: `src-${id}` },
    meta: {},
  };
}

function makeRow(id = "row-1", kind = "replied" as const, head = "about Botox pricing") {
  return {
    id,
    time: "14:32",
    kind,
    head,
    timestampIso: "2026-05-28T12:30:00Z",
  };
}

// ── beforeEach: default "normal active" state ─────────────────────────────────
// Most tests override only the parts relevant to their scenario.

beforeEach(() => {
  // Identity
  greetingData = makeGreeting();
  greetingIsLoading = false;
  greetingIsError = false;
  statesData = [makeState()];
  stateIsLoading = false;
  haltedValue = false;

  // KeyResult
  allData = makeMetricsVM({ value: 42 });
  allIsError = false;
  allIsLoading = false;
  weekData = makeMetricsVM({ value: 7 });
  weekIsError = false;
  weekIsLoading = false;
  missionData = makeMission();
  missionIsLoading = false;

  // OpenDecisions
  feedData = {
    decisions: [makeDecision()],
    counts: { total: 1, approval: 1, handoff: 0 },
  };
  feedIsLoading = false;
  feedIsError = false;

  // WorkLog
  activityData = {
    rows: [makeRow("r1", "replied", "about Botox pricing")],
  };
  activityIsLoading = false;
  activityIsError = false;
});

// Helper to render the assembled panel for alex (set-up agent)
function renderAlexPanel() {
  return render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
}

// ── State matrix rows ──────────────────────────────────────────────────────────

describe("AgentPanel state matrix", () => {
  // ── Row 1: Loading ────────────────────────────────────────────────────────────
  // All slot hooks in isLoading:true state → skeletons; no error copy anywhere.
  it("1. Loading — all hooks loading → skeletons present; no error copy", () => {
    greetingIsLoading = true;
    greetingData = undefined;
    stateIsLoading = true;
    allIsLoading = true;
    allData = undefined;
    weekIsLoading = true;
    weekData = undefined;
    missionIsLoading = true;
    missionData = undefined;
    feedIsLoading = true;
    feedData = undefined;
    activityIsLoading = true;
    activityData = undefined;

    renderAlexPanel();

    // Radix Sheet renders into a portal (document.body), so use
    // document.querySelectorAll rather than container.querySelectorAll.
    // Skeletons must be present — check via data-kind="loading" attribute
    // (KeyResult, OpenDecisions, WorkLog all use this attribute on their skeleton containers)
    const loadingContainers = document.querySelectorAll("[data-kind='loading']");
    expect(loadingContainers.length).toBeGreaterThan(0);

    // No error copy must appear during loading (three-states invariant)
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no actions in the last 24 hours/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing waiting on you from/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load this week's number/i)).not.toBeInTheDocument();
  });

  // ── Row 2: Normal active ──────────────────────────────────────────────────────
  // Health line + this-week hero + decision count + first-person work-log all present.
  it("2. Normal active — health + hero (this week) + decisions + work-log all render together", () => {
    // weekData = week value 7 → "this week" (lifetime/window=all is not fetched)
    // decisions = 1
    // work-log = "I replied to … about Botox pricing"
    renderAlexPanel();

    // Health line (fresh)
    expect(screen.getByText("Nothing old is waiting")).toBeInTheDocument();
    // This-week hero number and eyebrow
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/this week/i)).toBeInTheDocument();
    // Decision count
    expect(screen.getByText("1")).toBeInTheDocument();
    // First-person work-log sentence
    expect(screen.getByText(/I replied to/i)).toBeInTheDocument();
    // Freshness foot
    expect(screen.getByTestId("freshness-foot")).toBeInTheDocument();
    expect(screen.getByTestId("freshness-foot")).toHaveTextContent(/^as of /);
  });

  // ── Identity is rendered ONCE ────────────────────────────────────────────────
  // The SheetHeader owns the agent identity (avatar + name + role). The
  // IdentityStatus slot must NOT repeat it, or the panel shows a stacked
  // duplicate "Alex · Lead response" header. InboxAgentAvatar is mocked to
  // data-testid="agent-avatar", so exactly one avatar means no duplication.
  it("renders the agent identity exactly once (header owns it; slot does not duplicate)", () => {
    renderAlexPanel();
    expect(document.querySelectorAll('[data-testid="agent-avatar"]')).toHaveLength(1);
  });

  // ── Row 3: Week hero scope ───────────────────────────────────────────────────
  // Hero appears under "this week" label; NEVER "since you hired" (lifetime is
  // not fetched — projectMetrics is week-only); NOT an error.
  it("3. week hero renders under 'this week', not 'since you hired', not error", () => {
    weekData = makeMetricsVM({ kind: "tours-booked", value: 7 });

    renderAlexPanel();

    // Week value shown
    expect(screen.getByText("7")).toBeInTheDocument();
    // Eyebrow MUST be "this week"
    expect(screen.getByText(/this week/i)).toBeInTheDocument();
    // "since you hired" must NOT appear — label bound to window that returned
    expect(screen.queryByText(/since you hired/i)).not.toBeInTheDocument();
    // Error copy must NOT appear
    expect(screen.queryByText(/couldn't load this week's number/i)).not.toBeInTheDocument();
  });

  // ── Row 4: One-slot fetch error ───────────────────────────────────────────────
  // Decisions slot errors → "Couldn't load decisions";
  // identity (health line), hero number, and work-log rows still render correctly.
  // This is the critical "one slot error doesn't blank the others" test.
  it("4. One-slot error (decisions) — decisions shows error; identity/hero/work-log still render", () => {
    feedIsError = true;
    feedData = undefined;
    // weekData stays from beforeEach (value=7), work-log stays (replied row)

    renderAlexPanel();

    // Decisions error — canonical string
    expect(screen.getByText("Couldn't load decisions")).toBeInTheDocument();

    // Identity still renders (health line present)
    expect(screen.getByText("Nothing old is waiting")).toBeInTheDocument();

    // Hero still renders (week value 7)
    expect(screen.getByText("7")).toBeInTheDocument();

    // Work-log still renders (first-person sentence)
    expect(screen.getByText(/I replied to/i)).toBeInTheDocument();

    // Panel is NOT blanked — dialog is still there
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ── Row 5: True zero ──────────────────────────────────────────────────────────
  // Hero shows "0" (not error, not empty). Nothing old is waiting (health).
  it("5. True zero — hero shows 0, not error/empty; health still renders", () => {
    allData = undefined;
    allIsError = true;
    weekData = makeMetricsVM({ kind: "tours-booked", value: 0 });

    renderAlexPanel();

    // "0" must appear — true zero must show, never coerced away
    expect(screen.getByText("0")).toBeInTheDocument();
    // Label present ("consults booked")
    expect(screen.getByText(/consults booked/i)).toBeInTheDocument();
    // No error message — zero is NOT a failed fetch
    expect(screen.queryByText(/couldn't load this week's number/i)).not.toBeInTheDocument();
    // Health line still present (fresh signal)
    expect(screen.getByText("Nothing old is waiting")).toBeInTheDocument();
  });

  // ── Row 6: Paused ─────────────────────────────────────────────────────────────
  // "Paused" badge + "Paused from your workspace controls" in identity.
  // Hero: real historical result (muted) + "No new actions are going out while paused".
  // Decisions + work-log still show their genuine states.
  // No health read ("Nothing old is waiting" must NOT appear).
  it("6. Paused — badge + paused status; real hero + paused note; decisions + work-log intact", () => {
    haltedValue = true;
    // Clear allData so week is the data source (scope="week", value=12).
    // selectKeyResult with halted=true picks all.data ?? week.data.
    allData = undefined;
    allIsError = true;
    weekData = makeMetricsVM({ kind: "tours-booked", value: 12 });

    renderAlexPanel();

    // Identity: Paused badge
    expect(screen.getByText("Paused")).toBeInTheDocument();
    // Identity: paused status copy
    expect(screen.getByText("Paused from your workspace controls")).toBeInTheDocument();
    // Health read must NOT appear when paused
    expect(screen.queryByText("Nothing old is waiting")).not.toBeInTheDocument();

    // Hero: real historical value (12) present (muted, but still shown)
    expect(screen.getByText("12")).toBeInTheDocument();
    // Hero: paused note
    expect(screen.getByText("No new actions are going out while paused")).toBeInTheDocument();

    // Decisions still render (not blanked)
    // feed has 1 decision from beforeEach → "Needs you" section + count "1"
    expect(screen.getByText("Needs you")).toBeInTheDocument();

    // Work-log still renders
    expect(screen.getByText(/I replied to/i)).toBeInTheDocument();
  });

  // ── Row 7: Setup blocked (activation) ────────────────────────────────────────
  // Riley with core `meta` setup incomplete → activation CTA replaces the hero.
  // Decisions + work-log show their genuine states (typically empty).
  it("7. Setup blocked — activation CTA shows (Riley core meta incomplete); no proof hero", () => {
    haltedValue = false;
    // Use riley agentKey for this scenario
    allData = undefined;
    allIsError = true;
    weekData = undefined;
    weekIsError = true;
    missionData = makeMission({
      agentKey: "riley",
      setupRows: [{ key: "meta", done: false, primary: true }],
    });

    render(<AgentPanel agentKey="riley" open onOpenChange={() => {}} />);

    // Activation block replaces the hero
    expect(screen.getByTestId("activation-block")).toBeInTheDocument();
    // Value-framed activation copy (not task-framed)
    expect(
      screen.getByText(/Connect Meta Ads so Riley can start finding leads/i),
    ).toBeInTheDocument();

    // No proof hero (error message also not present — it's replaced by activation)
    expect(screen.queryByText(/couldn't load this week's number/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/since you hired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  });

  // ── Row 8: Mira ───────────────────────────────────────────────────────────────
  // "Mira isn't set up yet"; NONE of the data-slot content or scaffold.
  it("8. Mira — honest not-set-up body; no data-slot content or hero scaffold", () => {
    render(<AgentPanel agentKey="mira" open onOpenChange={() => {}} />);

    // Mira honest copy
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();

    // Data-slot content must NOT appear
    expect(screen.queryByText("Nothing old is waiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(screen.queryByText(/since you hired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load decisions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/I replied to/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No update yet/i)).not.toBeInTheDocument();
    // Freshness foot must NOT appear for Mira (no data slots)
    expect(screen.queryByTestId("freshness-foot")).not.toBeInTheDocument();
  });
});
