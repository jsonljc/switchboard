import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Controllable per-test state
let allData: unknown = undefined;
let allIsError = false;
let allIsLoading = false;
let weekData: unknown = undefined;
let weekIsError = false;
let weekIsLoading = false;
let missionData: unknown = undefined;
let missionIsLoading = false;
let haltedValue = false;

vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: vi.fn((agentKey: string, metricWindow: "week" | "all" = "week") => {
    if (metricWindow === "all") {
      return { data: allData, isError: allIsError, isLoading: allIsLoading, error: null };
    }
    return { data: weekData, isError: weekIsError, isLoading: weekIsLoading, error: null };
  }),
}));

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({
    data: missionData,
    isLoading: missionIsLoading,
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
    roi?: unknown;
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
    roi: overrides.roi,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KeyResult slot — launch-blocker tests", () => {
  beforeEach(() => {
    allData = undefined;
    allIsError = false;
    allIsLoading = false;
    weekData = undefined;
    weekIsError = false;
    weekIsLoading = false;
    missionData = undefined;
    missionIsLoading = false;
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

  // Riley ROI proof now comes from the server-computed roi.comparator (cost per booked).
  it("6. Riley roi proof — renders 'cost per booked' comparator, neutral, no green/red classes", () => {
    allData = makeMetricsVM({
      kind: "ad-leads",
      value: 32,
      roi: {
        degraded: true,
        degradedHint: "",
        label: "cost per booked",
        comparator: { value: "$44 per booked", target: "target $35" },
      },
    });
    const { container } = render(<KeyResult agentKey="riley" />);

    expect(screen.getByText("$44 per booked · target $35")).toBeInTheDocument();

    const allElements = container.querySelectorAll("[class]");
    allElements.forEach((el) => {
      const cls = el.className;
      expect(cls).not.toMatch(/\bup\b/);
      expect(cls).not.toMatch(/\bdown\b/);
      expect(cls).not.toMatch(/\bgood\b/);
      expect(cls).not.toMatch(/\bgreen\b/);
      expect(cls).not.toMatch(/\bred\b/);
    });
  });

  it("6b. Riley roi blank CAC (value '—') → renders NO comparator line", () => {
    allData = makeMetricsVM({
      kind: "ad-leads",
      value: 32,
      roi: {
        degraded: true,
        degradedHint: "No bookings attributed yet",
        label: "cost per booked",
        comparator: { value: "—", target: "target $35" },
      },
    });
    render(<KeyResult agentKey="riley" />);
    expect(screen.queryByText(/per booked/i)).not.toBeInTheDocument();
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

  // Gap 2 — value-framed activation copy: Riley
  it("gap2a. activation for riley uses value-framed copy naming Riley's outcome", () => {
    allData = undefined;
    allIsError = true;
    weekData = undefined;
    weekIsError = true;
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

    expect(screen.getByTestId("activation-block")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect Meta Ads so Riley can start finding leads/i),
    ).toBeInTheDocument();
    // Old task-framed copy must NOT appear
    expect(screen.queryByText(/to get started/i)).not.toBeInTheDocument();
  });

  // Gap 2 — value-framed activation copy: Alex
  it("gap2b. activation for alex uses value-framed copy naming Alex's outcome", () => {
    allData = undefined;
    allIsError = true;
    weekData = undefined;
    weekIsError = true;
    missionData = {
      agentKey: "alex",
      displayName: "Alex",
      setup: [{ key: "inbox", done: false, primary: true }],
      mission: {
        role: "assistant",
        pipeline: "crm",
        brand: "Clinic",
        channels: [],
        rules: null,
      },
      composerPlaceholder: "",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    };
    render(<KeyResult agentKey="alex" />);

    expect(screen.getByTestId("activation-block")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect your inbox so Alex can respond to leads/i),
    ).toBeInTheDocument();
    // Old task-framed copy must NOT appear
    expect(screen.queryByText(/to get started/i)).not.toBeInTheDocument();
  });

  // Gap 1 — non-core nudge present when proof + non-primary setup step incomplete
  it("gap1a. proof + non-core setup step incomplete → proof hero shows + non-core-nudge present + no activation-block", () => {
    allData = makeMetricsVM({ kind: "tours-booked", value: 8 });
    weekData = makeMetricsVM({ kind: "tours-booked", value: 2 });
    missionData = {
      agentKey: "alex",
      displayName: "Alex",
      setup: [
        { key: "inbox", done: true, primary: true },
        { key: "rules", done: false },
      ],
      mission: {
        role: "assistant",
        pipeline: "crm",
        brand: "Clinic",
        channels: [],
        rules: null,
      },
      composerPlaceholder: "",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    };
    render(<KeyResult agentKey="alex" />);

    // Proof hero shown (lifetime value)
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText(/since you hired Alex/i)).toBeInTheDocument();
    // Non-core nudge present
    expect(screen.getByTestId("non-core-nudge")).toBeInTheDocument();
    expect(screen.getByText(/Set your guardrails so Alex knows your limits/i)).toBeInTheDocument();
    // No activation block
    expect(screen.queryByTestId("activation-block")).not.toBeInTheDocument();
  });

  // Gap 1 — non-core nudge present when proof + non-core setup step incomplete (Riley rules)
  // Uses a real producer signal: Riley's setup emits [meta, rules]; when meta=done but rules=incomplete
  // the non-core setup nudge fires in the proof branch.
  it("gap1b. proof + non-core setup step incomplete (Riley rules) → proof hero shows + non-core-nudge present + no activation-block", () => {
    allData = makeMetricsVM({ kind: "ad-leads", value: 15 });
    weekData = makeMetricsVM({ kind: "ad-leads", value: 3 });
    missionData = {
      agentKey: "riley",
      displayName: "Riley",
      setup: [
        { key: "meta", done: true, primary: true },
        { key: "rules", done: false },
      ],
      mission: {
        role: "ad-optimizer",
        pipeline: "ads",
        brand: "Clinic",
        channels: [{ kind: "meta-ads", label: "Meta Ads", status: "ok" }],
        rules: null,
      },
      composerPlaceholder: "",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    };
    render(<KeyResult agentKey="riley" />);

    // Proof hero shown (lifetime value)
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText(/since you hired Riley/i)).toBeInTheDocument();
    // Non-core nudge present (rules setup row)
    expect(screen.getByTestId("non-core-nudge")).toBeInTheDocument();
    expect(screen.getByText(/Set your guardrails so Riley knows your limits/i)).toBeInTheDocument();
    // No activation block
    expect(screen.queryByTestId("activation-block")).not.toBeInTheDocument();
  });

  // Loading guard — on cold mount, isLoading:true must NOT collapse into error
  it("loading. any hook isLoading:true → renders skeleton (data-kind=loading / aria-busy) and NOT the error message or any hero number", () => {
    // Simulate cold mount: both metrics hooks still fetching, data undefined, isError false
    allIsLoading = true;
    weekIsLoading = true;
    allData = undefined;
    weekData = undefined;
    allIsError = false;
    weekIsError = false;
    const { container } = render(<KeyResult agentKey="alex" />);

    // Skeleton must be present — use attribute selectors (data-kind / aria-busy)
    const loadingEl = container.querySelector("[data-kind='loading']");
    expect(loadingEl).not.toBeNull();
    expect(loadingEl?.getAttribute("aria-busy")).toBe("true");

    // Error message must NOT appear — violates loading ≠ error invariant
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();

    // No hero number or eyebrow should appear
    expect(screen.queryByText(/since you hired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  });

  // Activation CTA — onActivate wired: clicking the button calls onActivate
  it("activation-cta. onActivate is called when the activation button is clicked", () => {
    allData = undefined;
    allIsError = true;
    weekData = undefined;
    weekIsError = true;
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
    const onActivate = vi.fn();
    render(<KeyResult agentKey="riley" onActivate={onActivate} />);

    // Activation block rendered
    expect(screen.getByTestId("activation-block")).toBeInTheDocument();
    // Click the CTA button
    const ctaBtn = screen.getByRole("button", { name: /Connect Meta Ads/i });
    ctaBtn.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  // Gap 1 — all-complete proof renders NO nudge
  it("gap1c. proof + all setup complete → no non-core-nudge", () => {
    allData = makeMetricsVM({ kind: "tours-booked", value: 20 });
    weekData = makeMetricsVM({ kind: "tours-booked", value: 4 });
    missionData = {
      agentKey: "alex",
      displayName: "Alex",
      setup: [
        { key: "inbox", done: true, primary: true },
        { key: "rules", done: true },
        { key: "cal", done: true },
      ],
      mission: {
        role: "assistant",
        pipeline: "crm",
        brand: "Clinic",
        channels: [
          { kind: "whatsapp", label: "WhatsApp", status: "ok" },
          { kind: "telegram", label: "Telegram", status: "ok" },
        ],
        rules: null,
      },
      composerPlaceholder: "",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    };
    render(<KeyResult agentKey="alex" />);

    // Proof hero shown
    expect(screen.getByText("20")).toBeInTheDocument();
    // No nudge
    expect(screen.queryByTestId("non-core-nudge")).not.toBeInTheDocument();
    // No activation block
    expect(screen.queryByTestId("activation-block")).not.toBeInTheDocument();
  });
});
