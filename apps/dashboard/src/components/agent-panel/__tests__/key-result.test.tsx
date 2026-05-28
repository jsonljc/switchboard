import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Controllable per-test state
let allData: unknown = undefined;
let allIsError = false;
let weekData: unknown = undefined;
let weekIsError = false;
let missionData: unknown = undefined;
let haltedValue = false;

vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: vi.fn((agentKey: string, metricWindow: "week" | "all" = "week") => {
    if (metricWindow === "all") {
      return { data: allData, isError: allIsError, isLoading: false, error: null };
    }
    return { data: weekData, isError: weekIsError, isLoading: false, error: null };
  }),
}));

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({
    data: missionData,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({
    halted: haltedValue,
    isPending: false,
    error: null,
    setHalted: vi.fn(),
    toggleHalt: vi.fn(),
  }),
}));

// Import component after mocks
import { KeyResult } from "../key-result";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeMetricsVM(
  overrides: {
    kind?: "tours-booked" | "ad-leads" | "creatives-shipped" | "revenue-attributed";
    value?: number;
    spendCents?: number | null;
    targetCpbCents?: number | null;
  } = {},
) {
  return {
    hero: {
      kind: overrides.kind ?? "tours-booked",
      value: overrides.value ?? 12,
      comparator: {},
    },
    spendCents: overrides.spendCents !== undefined ? overrides.spendCents : null,
    targets: {
      avgValueCents: null,
      targetCpbCents: overrides.targetCpbCents !== undefined ? overrides.targetCpbCents : null,
    },
    heroSubProseSegments: [],
    spark: [],
    stats: [
      { label: "l1", value: 0 },
      { label: "l2", value: 0 },
      { label: "l3", value: 0 },
    ],
    freshness: { generatedAt: "2026-05-26T10:00:00Z", window: "week", dataSource: "live" },
    folioRange: "this week",
    leads: 0,
    qualifiedPct: 0,
    bookedDelta: null,
    leadsDelta: null,
    qualifiedDelta: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KeyResult slot — launch-blocker tests", () => {
  beforeEach(() => {
    allData = undefined;
    allIsError = false;
    weekData = undefined;
    weekIsError = false;
    missionData = undefined;
    haltedValue = false;
  });

  // Blocker 1: window=all succeeds → hero under "since you hired …" (lifetime), shows the lifetime value.
  it("1. window=all succeeds → shows lifetime value under 'since you hired' eyebrow", () => {
    allData = makeMetricsVM({ kind: "tours-booked", value: 214 });
    weekData = makeMetricsVM({ kind: "tours-booked", value: 5 });
    render(<KeyResult agentKey="alex" />);

    // The big number shown should be the ALL-window value (214), not the week value (5)
    expect(screen.getByText("214")).toBeInTheDocument();
    // Eyebrow must contain "since you hired" (lifetime scope)
    expect(screen.getByText(/since you hired Alex/i)).toBeInTheDocument();
    // "this week" must NOT appear
    expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  });

  // Blocker 2: window=all 400/isError + week ok → hero under "this week" label, shows the WEEK value — NOT an error, NEVER "since you hired".
  it("2. window=all errors + week ok → shows week value under 'this week' label, not 'since you hired'", () => {
    allData = undefined;
    allIsError = true;
    weekData = makeMetricsVM({ kind: "tours-booked", value: 7 });
    render(<KeyResult agentKey="alex" />);

    // Week value shown
    expect(screen.getByText("7")).toBeInTheDocument();
    // Eyebrow must be "this week"
    expect(screen.getByText(/this week/i)).toBeInTheDocument();
    // "since you hired" must NOT appear
    expect(screen.queryByText(/since you hired/i)).not.toBeInTheDocument();
    // Error message must NOT appear
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  // Blocker 3: window=all errors AND week errors → "Couldn't load this week's number".
  it("3. both all and week error → shows error message", () => {
    allData = undefined;
    allIsError = true;
    weekData = undefined;
    weekIsError = true;
    render(<KeyResult agentKey="alex" />);

    expect(screen.getByText("Couldn't load this week's number")).toBeInTheDocument();
    // No hero value, no "since you hired", no "this week" eyebrow
    expect(screen.queryByText(/since you hired/i)).not.toBeInTheDocument();
  });

  // Blocker 4: week value 0 (set up, not paused) → renders the true zero ("0 …"), not error/empty/null.
  it("4. true zero value=0 (setup complete, not paused) → renders '0', not error or empty", () => {
    allData = undefined;
    allIsError = true; // all fails; fall to week
    weekData = makeMetricsVM({ kind: "tours-booked", value: 0 });
    render(<KeyResult agentKey="alex" />);

    // "0" must be in the document
    expect(screen.getByText("0")).toBeInTheDocument();
    // Must have a label
    expect(screen.getByText(/consults booked/i)).toBeInTheDocument();
    // Error message must NOT appear
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  // Blocker 5: halted + week value 12 → shows 12 (muted) + "No new actions are going out while paused", and NO health/comparator beat.
  it("5. halted + week value 12 → shows 12 (muted) + paused note; no CPL comparator", () => {
    haltedValue = true;
    weekData = makeMetricsVM({ kind: "tours-booked", value: 12 });
    render(<KeyResult agentKey="alex" />);

    // Hero value shown (muted)
    expect(screen.getByText("12")).toBeInTheDocument();
    // Paused note
    expect(screen.getByText("No new actions are going out while paused")).toBeInTheDocument();
    // No CPL comparator text
    expect(screen.queryByText(/per lead/i)).not.toBeInTheDocument();
    // No error message
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  // Blocker 6: Riley CPL beat: spendCents 142000, hero ad-leads value 32, targetCpbCents 3500 → renders "$44.38 per lead · $9.38 over your $35 target" (neutral text; assert NO element has a green/up or red/down class).
  it("6. Riley CPL beat — correct neutral text, no green/red classes", () => {
    allData = makeMetricsVM({
      kind: "ad-leads",
      value: 32,
      spendCents: 142000,
      targetCpbCents: 3500,
    });
    render(<KeyResult agentKey="riley" />);

    // Must show the CPL beat text
    expect(screen.getByText(/\$44\.38 per lead/i)).toBeInTheDocument();
    expect(screen.getByText(/\$9\.38 over your \$35 target/i)).toBeInTheDocument();

    // Assert NO element has a green/up or red/down class
    const { container } = render(<KeyResult agentKey="riley" />);
    const allElements = container.querySelectorAll("[class]");
    allElements.forEach((el) => {
      const cls = el.className;
      expect(cls).not.toMatch(/\bup\b/);
      expect(cls).not.toMatch(/\bdown\b/);
      expect(cls).not.toMatch(/\bgood\b/);
      expect(cls).not.toMatch(/\bgreen\b/);
      expect(cls).not.toMatch(/\bred\b/);
      expect(cls).not.toMatch(/\bcritical\b/);
    });
  });

  // Blocker 7: halted + core-setup-incomplete (mission setup has { primary: true, done: false }) + week value 12 → paused composition wins (shows 12 + paused note + a small setup note), and the activation block is NOT rendered.
  it("7. halted + core-setup-incomplete + week value 12 → paused wins; no activation block", () => {
    haltedValue = true;
    weekData = makeMetricsVM({ kind: "ad-leads", value: 12 });
    missionData = {
      agentKey: "riley",
      displayName: "Riley",
      setup: [{ key: "meta", done: false, primary: true }],
      mission: {
        role: "ad-optimizer",
        pipeline: "ads",
        brand: "Clinic",
        channels: [],
        rules: null,
      },
      composerPlaceholder: "",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    };
    render(<KeyResult agentKey="riley" />);

    // Paused hero shown
    expect(screen.getByText("12")).toBeInTheDocument();
    // Paused note present
    expect(screen.getByText("No new actions are going out while paused")).toBeInTheDocument();
    // Setup note present (small note below paused note)
    expect(screen.getByTestId("setup-note")).toBeInTheDocument();
    // Activation block NOT rendered
    expect(screen.queryByTestId("activation-block")).not.toBeInTheDocument();
  });
});
