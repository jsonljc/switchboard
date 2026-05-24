import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Module-level shared mock state (used by both B.1 and B.3 describes)
// ---------------------------------------------------------------------------

const haltState = { halted: false };
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: haltState.halted, setHalted: vi.fn(), toggleHalt: vi.fn() }),
  HaltProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const rileyApprovalsState = { approvals: [] as unknown[] };
vi.mock("@/hooks/use-riley-approvals", () => ({
  useRileyApprovals: () => ({
    approvals: rileyApprovalsState.approvals,
    isLoading: false,
    isError: false,
  }),
}));

const rileyStatusState = { status: "IDLE" as const };
vi.mock("@/hooks/use-riley-status", () => ({
  useRileyStatus: () => rileyStatusState.status,
}));

const rileyActivityState = { rows: [] as unknown[] };
vi.mock("@/hooks/use-riley-activity", () => ({
  useRileyActivity: () => ({ rows: rileyActivityState.rows, isLoading: false, isError: false }),
}));

// B.2b mock — use-agent-metrics. Mirrors the four fields the real hook
// returns (apps/dashboard/src/hooks/use-agent-metrics.ts:34-39): data,
// isLoading, isError, error. A future refactor that reads metricsQ.error
// will see a fresh null rather than undefined.
const metricsState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = {
  data: null,
  isLoading: false,
  isError: false,
  error: null,
};
vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: () => metricsState,
}));

// B.2a mock — use-agent-mission.
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

let missionData: MissionAggregatorResponse | undefined = undefined;

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: missionData, isLoading: false, isError: false }),
}));

// ---------------------------------------------------------------------------
// B.3 mocks — use-recommendation-action (keyed by id) and use-toast
// ---------------------------------------------------------------------------

const actionCalls: Array<{ id: string; verb: "primary" | "dismiss" }> = [];
const toast = vi.fn();
const mockConfig = { rejectPrimary: false };

vi.mock("@/hooks/use-recommendation-action", () => ({
  useRecommendationAction: (id: string) => ({
    primary: vi.fn(async () => {
      actionCalls.push({ id, verb: "primary" });
      if (mockConfig.rejectPrimary) throw new Error("network failed");
    }),
    dismiss: vi.fn(async () => {
      actionCalls.push({ id, verb: "dismiss" });
    }),
  }),
}));
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast }),
}));

// ActivityRow now calls useRouter() for the "Tell Alex about" deep-link.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Static imports (used by B.1 tests)
// ---------------------------------------------------------------------------

import { RileyCockpitPage } from "../riley-cockpit-page";
import {
  pauseFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures";
import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows";

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// B.1 tests (preserved)
// ---------------------------------------------------------------------------

describe("RileyCockpitPage", () => {
  it("renders Riley Identity", () => {
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText("Riley").length).toBeGreaterThanOrEqual(1);
  });

  it("renders IDLE status pill in cold state", () => {
    rileyStatusState.status = "IDLE" as const;
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText(/IDLE/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders HALTED state when halt is active", () => {
    haltState.halted = true;
    (rileyStatusState as { status: string }).status = "HALTED";
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText(/HALTED/i).length).toBeGreaterThanOrEqual(1);
    haltState.halted = false;
    (rileyStatusState as { status: string }).status = "IDLE";
  });
});

// --- B.1 Task 17: data-driven end-to-end coverage ---

describe("RileyCockpitPage — data-driven states", () => {
  it("cold state: no Meta connection → 3 synthetic onboarding rows surface", () => {
    rileyActivityState.rows = coldStateActivityRows();
    (rileyStatusState as { status: string }).status = "IDLE";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Connect Meta Ads to begin/i)).toBeInTheDocument();
    expect(screen.getByText(/Set average lead value/i)).toBeInTheDocument();
    expect(screen.getByText(/Standing rules loaded/i)).toBeInTheDocument();
    rileyActivityState.rows = [];
  });

  it("steady state: 1 pending pause rec → WAITING pill + Pause card", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews([pauseFixture]);
    (rileyStatusState as { status: string }).status = "WAITING";
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText(/WAITING/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Pause adset/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(pauseFixture.humanSummary)).toBeInTheDocument();
    rileyApprovalsState.approvals = [];
    (rileyStatusState as { status: string }).status = "IDLE";
  });

  it("signal-health: 3 raw rows → 1 grouped account-level card; no 'Dismiss all' button", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews(signalHealthFixtures);
    (rileyStatusState as { status: string }).status = "WAITING";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Open Events Manager/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dismiss all/i)).not.toBeInTheDocument();
    rileyApprovalsState.approvals = [];
    (rileyStatusState as { status: string }).status = "IDLE";
  });

  it("composer placeholder responds to halted state", () => {
    haltState.halted = true;
    (rileyStatusState as { status: string }).status = "HALTED";
    wrap(<RileyCockpitPage />);
    // ComposerPlaceholder uses `halted` prop — verify the page renders without crashing
    // and the HALTED status pill appears (proxy for halted-mode rendering).
    expect(screen.getAllByText(/HALTED/i).length).toBeGreaterThanOrEqual(1);
    haltState.halted = false;
    (rileyStatusState as { status: string }).status = "IDLE";
  });
});

// ---------------------------------------------------------------------------
// B.3 fixtures
// ---------------------------------------------------------------------------

const rec1 = {
  id: "rec-1",
  kind: "pause" as const,
  urgency: "immediate" as const,
  askedAt: "2m",
  title: "Pause Cold Interests",
  presentation: { primaryLabel: "Pause", dismissLabel: "Dismiss" },
  primary: "Pause",
  secondary: "Reduce 50%",
  campaign: { kind: "campaign" as const, name: "Cold Interests", id: "c-1" },
  confidence: 0.9,
  learningPhaseImpact: "no impact" as const,
  reversible: true,
  primaryAction: { kind: "internal" as const, intent: "recommendation.pause", parameters: {} },
  acceptToast: "Paused Cold Interests. Standing by.",
  declineToast: "Leaving Cold Interests running.",
};
const rec2 = {
  ...rec1,
  id: "rec-2",
  kind: "scale" as const,
  title: "Scale BR-Whitening",
  primary: "Scale 20%",
  secondary: "Hold",
  campaign: { kind: "campaign" as const, name: "BR-Whitening", id: "c-2" },
  primaryAction: { kind: "internal" as const, intent: "recommendation.scale", parameters: {} },
  acceptToast: undefined,
  declineToast: undefined,
};
const rec3 = {
  ...rec1,
  id: "rec-3",
  kind: "review_budget" as const,
  title: "Review Cold Interests budget",
  primary: "Review budget",
  secondary: "Hold",
  campaign: { kind: "campaign" as const, name: "Cold Interests", id: "c-1" },
  primaryAction: {
    kind: "external" as const,
    url: "https://business.facebook.com/adsmanager/manage/campaigns?act=123",
    service: "meta" as const,
  },
  acceptToast: "Opening Meta to review Cold Interests's budget.",
  declineToast: "Holding Cold Interests's budget where it is.",
};

// ---------------------------------------------------------------------------
// B.3 tests
// ---------------------------------------------------------------------------

describe("RileyCockpitPage — B.3 voice + accent", () => {
  beforeEach(() => {
    actionCalls.length = 0;
    toast.mockReset();
    mockConfig.rejectPrimary = false;
    // Set up the 3-approval state for B.3 tests
    rileyApprovalsState.approvals = [rec1, rec2, rec3];
    (rileyStatusState as { status: string }).status = "WAITING";
  });

  it("renders the Riley sender label on every approval card", () => {
    render(<RileyCockpitPage />);
    expect(screen.getAllByText("Riley needs you").length).toBe(3);
  });

  it("clicking accept on the first card calls primary() bound to rec-1 and fires its acceptToast", async () => {
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Pause"));
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-1", verb: "primary" }]);
    expect(toast).toHaveBeenCalledWith({ title: "Paused Cold Interests. Standing by." });
  });

  it("clicking decline on the first card calls dismiss() bound to rec-1 and fires its declineToast", async () => {
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Reduce 50%"));
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-1", verb: "dismiss" }]);
    expect(toast).toHaveBeenCalledWith({ title: "Leaving Cold Interests running." });
  });

  it("clicking accept on the second card calls primary() bound to rec-2 (per-row hook binding)", async () => {
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Scale 20%"));
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-2", verb: "primary" }]);
  });

  it("falls back to per-kind rileyToast copy when engine omitted acceptToast / declineToast", async () => {
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Scale 20%"));
    await Promise.resolve();
    expect(toast).toHaveBeenCalledWith({ title: "Scaling — back to scanning." });
  });

  it("external-action primary opens the Meta URL and does NOT call primary() or fire a toast", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Review budget"));
    await Promise.resolve();
    expect(openSpy).toHaveBeenCalledWith(
      "https://business.facebook.com/adsmanager/manage/campaigns?act=123",
      "_blank",
      "noopener,noreferrer",
    );
    expect(actionCalls).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("external-action decline still calls dismiss() and fires the decline toast", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<RileyCockpitPage />);
    const holds = screen.getAllByText("Hold");
    fireEvent.click(holds[holds.length - 1]!);
    await Promise.resolve();
    expect(openSpy).not.toHaveBeenCalled();
    expect(actionCalls).toEqual([{ id: "rec-3", verb: "dismiss" }]);
    expect(toast).toHaveBeenCalledWith({ title: "Holding Cold Interests's budget where it is." });
    openSpy.mockRestore();
  });

  it("success-only toast — toast does not fire if the mutation rejects", async () => {
    mockConfig.rejectPrimary = true;
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Pause"));
    await Promise.resolve();
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-1", verb: "primary" }]);
    expect(toast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B.2b tests — KPI strip mount
// ---------------------------------------------------------------------------

describe("RileyCockpitPage — B.2b KPI strip", () => {
  // Local fixture builder — reused across cases. The wire shape mirrors
  // MetricsViewModelWire; minimal fields populated to satisfy the page render.
  function buildMetricsFixture(overrides: Partial<{ tiles: unknown; roi: unknown }> = {}) {
    const base = {
      hero: {
        kind: "ad-leads" as const,
        value: 27,
        comparator: { window: "week" as const, value: 22 },
      },
      heroSubProseSegments: [],
      spark: [],
      stats: [],
      freshness: { generatedAt: "x", window: "week" as const, dataSource: "live" as const },
      folioRange: "Mon — Wed",
      targets: { avgValueCents: null, targetCpbCents: null },
      spendCents: 20000,
      leads: 27,
      qualifiedPct: 0,
      bookedDelta: "+5",
      leadsDelta: "+5",
      qualifiedDelta: null,
      tiles: [
        { label: "leads", value: 27, trend: "+5" },
        { label: "ctr", value: "—", unavailable: true },
        { label: "ad spend", value: "$200" },
      ],
      roi: {
        degraded: true as const,
        degradedHint: "",
        label: "cost per lead",
        comparator: { value: "$7 per lead", target: "—" },
      },
    };
    return { ...base, ...overrides };
  }

  beforeEach(() => {
    rileyApprovalsState.approvals = [];
    rileyActivityState.rows = []; // prevent activity-kind="qualified" rows from polluting the no-qualified assertion
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
  });

  it("renders <KPIStrip> in expanded mode when metrics data exists and no approvals", () => {
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const strip = screen.getByTestId("kpi-strip");
    expect(within(strip).getByText("$200")).toBeInTheDocument();
    expect(within(strip).getByText(/cost per lead/i)).toBeInTheDocument();
    expect(within(strip).getByText("$7 per lead")).toBeInTheDocument();
  });

  it("collapses to single-line headline when approvals.length > 0", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews([pauseFixture]);
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const strip = screen.getByTestId("kpi-strip");
    // Collapsed headline is "27 leads · +5 from last week" (driven by collapsedHeadline()).
    expect(within(strip).getByText(/27/)).toBeInTheDocument();
    expect(within(strip).getByText(/leads/i)).toBeInTheDocument();
  });

  it("renders nothing for KPI strip when metrics is loading or errored", () => {
    metricsState.isLoading = true;
    wrap(<RileyCockpitPage />);
    expect(screen.queryByTestId("kpi-strip")).not.toBeInTheDocument();
  });

  it("renders nothing for KPI strip when wire VM is missing tiles (no Alex fallback)", () => {
    // Adapter returns null when tiles is missing; page renders no strip.
    const { tiles: _omit, ...withoutTiles } = buildMetricsFixture();
    metricsState.data = withoutTiles;
    wrap(<RileyCockpitPage />);
    expect(screen.queryByTestId("kpi-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roi-comparator")).not.toBeInTheDocument();
  });

  it("hard regression: KPI strip never renders a 'qualified' label (no legacy leak)", () => {
    // Even with full live data, no qualified tile should appear inside the
    // strip — Riley is not qualifying leads. The assertion is scoped to the
    // strip subtree via data-testid so it cannot false-pass on (a) the
    // ActivityStream's `QUALIFIED` activity-kind label (kind-meta.ts:18), nor
    // (b) an empty render where the strip never mounted.
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const strip = screen.getByTestId("kpi-strip"); // positive presence — fails fast if missing
    expect(within(strip).queryByText(/qualified/i)).not.toBeInTheDocument();
  });

  it("applies RILEY_ACCENT to the ROI comparator chip", () => {
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveStyle({ background: "#EBF5F4" }); // RILEY_ACCENT.paper (teal identity)
  });
});

// ---------------------------------------------------------------------------
// B.2a tests — mission popover wiring
// ---------------------------------------------------------------------------

const RILEY_MISSION_DATA: MissionAggregatorResponse = {
  agentKey: "riley",
  displayName: "Riley",
  mission: {
    role: "Ad optimizer · score, recommend, never act without your approval",
    pipeline: "Ad sets · all campaigns",
    brand: "Acme Medspa · —",
    channels: [{ kind: "meta-ads", label: "Meta Ads", status: "ok" }],
    rules: null,
  },
  composerPlaceholder: "Tell Riley what to do — coming soon",
  commands: [],
  targets: { avgValueCents: 12000, targetCpbCents: 2500, roasSource: "deterministic" },
  setup: [
    { key: "meta", done: true },
    { key: "rules", done: true },
  ],
};

describe("RileyCockpitPage — B.2a mission popover", () => {
  beforeEach(() => {
    rileyApprovalsState.approvals = [];
    rileyActivityState.rows = [];
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
    // Reset module-level missionData here so an assertion that throws inside
    // waitFor() can't leave stale state for the next test.
    missionData = undefined;
  });

  it("keeps the subtitle non-interactive while mission data is undefined", () => {
    wrap(<RileyCockpitPage />);
    // The subtitle text is rendered as plain text, not a button.
    expect(screen.queryByRole("button", { name: /Optimizing Meta Ads/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Optimizing Meta Ads/i).length).toBeGreaterThanOrEqual(1);
  });

  it("makes the subtitle clickable once mission data loads and toggles the popover", async () => {
    missionData = RILEY_MISSION_DATA;
    wrap(<RileyCockpitPage />);
    const subtitle = await screen.findByRole("button", { name: /Optimizing Meta Ads/i });
    fireEvent.click(subtitle);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Riley mission/i })).toBeInTheDocument(),
    );
    // Click again — popover closes.
    fireEvent.click(subtitle);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Riley mission/i })).not.toBeInTheDocument(),
    );
  });

  it("renders Riley-shaped mission rows inside the popover", async () => {
    missionData = RILEY_MISSION_DATA;
    wrap(<RileyCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Optimizing Meta Ads/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Riley mission/i })).toBeInTheDocument(),
    );
    // Each eyebrow appears verbatim.
    expect(
      screen.getByText(/Ad optimizer · score, recommend, never act without your approval/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ad sets · all campaigns/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Medspa · —/i)).toBeInTheDocument();
    // No RULES row for Riley (mission.rules is null).
    expect(screen.queryByText(/^RULES$/)).not.toBeInTheDocument();
  });

  it("does NOT render the Day-1 EmptyState (Riley uses synthetic activity rows for cold state)", () => {
    missionData = {
      ...RILEY_MISSION_DATA,
      setup: [
        { key: "meta", done: false, primary: true },
        { key: "rules", done: false },
      ],
    };
    wrap(<RileyCockpitPage />);
    expect(screen.queryByTestId("cockpit-empty-state")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// B.3-followup tests — palette wiring on /riley
// ---------------------------------------------------------------------------

describe("RileyCockpitPage — B.3-followup palette wiring", () => {
  beforeEach(() => {
    rileyApprovalsState.approvals = [];
    rileyActivityState.rows = [];
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
    missionData = undefined;
    toast.mockReset();
  });

  it("⌘K opens the command palette", async () => {
    wrap(<RileyCockpitPage />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
  });

  it("Escape closes the palette", async () => {
    wrap(<RileyCockpitPage />);
    // Open via ⌘K (Topbar was removed; keydown listener on the page still works)
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: /Command palette/i });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Command palette/i })).not.toBeInTheDocument(),
    );
  });

  it("selecting 'Resume Riley' fires the dispatcher (toast fires; palette closes)", async () => {
    wrap(<RileyCockpitPage />);
    // Open via ⌘K (Topbar was removed; keydown listener on the page still works)
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Resume Riley"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Command palette/i })).not.toBeInTheDocument(),
    );
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });
});

describe("RileyCockpitPage — composer adoption", () => {
  beforeEach(() => {
    haltState.halted = false;
    rileyApprovalsState.approvals = [];
    rileyStatusState.status = "IDLE";
    rileyActivityState.rows = [];
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
    missionData = undefined;
    actionCalls.length = 0;
    toast.mockReset();
    mockConfig.rejectPrimary = false;
  });

  it("renders the live Composer (not the placeholder)", () => {
    wrap(<RileyCockpitPage />);
    expect(screen.getByRole("textbox", { name: "Composer input" })).toBeInTheDocument();
  });

  it("Composer placeholder is Riley's locked copy", () => {
    wrap(<RileyCockpitPage />);
    const input = screen.getByRole("textbox", { name: "Composer input" });
    expect(input).toHaveAttribute(
      "placeholder",
      "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…",
    );
  });

  // Composer adopted the design's stage-then-confirm flow: typing + Enter
  // stages a structured chip; the operator must click Confirm to commit.
  // Tests below click the Confirm button after the staged chip appears,
  // matching the Alex Home v2 design flow shared across both cockpits.
  async function stageAndConfirm(value: string) {
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
    const confirm = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirm);
  }

  it("typing 'pause for 1h' + stage+confirm dispatches a pause toast", async () => {
    wrap(<RileyCockpitPage />);
    await stageAndConfirm("pause for 1h");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string; description?: string };
    expect(payload.title).toBe("Paused — standing by.");
    expect(payload.description).toMatch(/^until /);
  });

  it("typing 'resume' + stage+confirm fires Riley-specific resume copy", async () => {
    wrap(<RileyCockpitPage />);
    await stageAndConfirm("resume");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("ad-ops free-form ('raise daily budget to $200') falls through to 'not automated yet' (no mutation)", async () => {
    wrap(<RileyCockpitPage />);
    await stageAndConfirm("raise daily budget to $200");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    expect(payload.title).toBe("Noted.");
    expect(payload.description).toContain('"raise daily budget to $200" is not automated yet.');
  });

  it("campaign-targeted NL ('pause the Cold Interests adset') stays inert (no halt, no router push)", async () => {
    wrap(<RileyCockpitPage />);
    await stageAndConfirm("pause the Cold Interests adset");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    // Critical regression guard: "pause the Cold Interests adset" must NOT
    // parse as a real pause (which would setHalted + show "Paused —
    // standing by."). Falls through to instruction → 'not automated yet'.
    expect(payload.title).toBe("Noted.");
    expect(payload.description).toContain("is not automated yet.");
  });

  it("'follow up with Maya tonight' folds into 'not automated yet' toast", async () => {
    wrap(<RileyCockpitPage />);
    await stageAndConfirm("follow up with Maya tonight");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: "Noted." });
  });

  it("'stop offering free consults' + stage+confirm routes to rules and toasts", async () => {
    wrap(<RileyCockpitPage />);
    await stageAndConfirm("stop offering free consults");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string };
    expect(payload.title).toBe("Opening rules.");
  });

  it("Enter stages the parsed action — never dispatches without Confirm", async () => {
    wrap(<RileyCockpitPage />);
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "pause for 1h" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Staged chip should be visible; toast should NOT have fired.
    expect(await screen.findByTestId("composer-pending")).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it("Undo discards a staged action without dispatching", async () => {
    wrap(<RileyCockpitPage />);
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "pause" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const undo = await screen.findByRole("button", { name: /undo/i });
    fireEvent.click(undo);
    expect(toast).not.toHaveBeenCalled();
  });

  it("Escape clears the input without staging", () => {
    wrap(<RileyCockpitPage />);
    const input = screen.getByRole("textbox", { name: "Composer input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pause" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(toast).not.toHaveBeenCalled();
  });

  it("Composer is disabled when halted", () => {
    haltState.halted = true;
    wrap(<RileyCockpitPage />);
    const input = screen.getByRole("textbox", { name: "Composer input" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "Halted — resume to send instructions");
  });
});

describe("RileyCockpitPage — Task 13 ActivityStream `today` eyebrow", () => {
  it("passes a `today` string prop to <ActivityStream> so the eyebrow shows the date", () => {
    haltState.halted = false;
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/^Today · /)).toBeInTheDocument();
  });
});
