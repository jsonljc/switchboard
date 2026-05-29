import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock InboxAgentAvatar to avoid sprite/canvas rendering in tests
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

// Controllable per-test
let greetingData: unknown = undefined;
let greetingIsError = false;
let statesData: unknown[] = [];
let haltedValue = false;

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({
    data: greetingData,
    isLoading: false,
    isError: greetingIsError,
    error: null,
  }),
}));

vi.mock("@/hooks/use-agents", () => ({
  useAgentState: () => ({
    data: { states: statesData },
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
import { IdentityStatus } from "../identity-status";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW_ISO = "2026-05-26T14:00:00Z";

function makeGreeting(
  overrides: {
    segments?: Array<{ kind: "text" | "accent"; text: string }>;
    oldestOpenItemAgeHours?: number | null;
  } = {},
) {
  // Use "oldestOpenItemAgeHours" in overrides explicitly to allow null
  const ageHours = "oldestOpenItemAgeHours" in overrides ? overrides.oldestOpenItemAgeHours : 2;
  return {
    variant: "named-lead",
    segments: overrides.segments ?? [
      { kind: "text", text: "Steady morning — " },
      { kind: "accent", text: "answered every lead" },
    ],
    signal: {
      inboxCount: 3,
      oldestOpenItemAgeHours: ageHours,
      hoursSinceLastOperatorAction: 1,
    },
    freshness: {
      generatedAt: NOW_ISO,
      window: "today",
      dataSource: "live",
    },
  };
}

function makeState(
  opts: { agentRole: string; lastActionAt: string | null } = {
    agentRole: "responder",
    lastActionAt: "2026-05-26T13:50:00Z",
  },
) {
  return {
    agentRole: opts.agentRole,
    activityStatus: "working",
    lastActionAt: opts.lastActionAt,
    currentTask: null,
    lastActionSummary: null,
    metrics: {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IdentityStatus slot", () => {
  beforeEach(() => {
    greetingData = makeGreeting();
    greetingIsError = false;
    statesData = [makeState()];
    haltedValue = false;
  });

  it("(a) renders ALL text + accent segments joined — not just the first", () => {
    greetingData = makeGreeting({
      segments: [
        { kind: "text", text: "Steady morning — " },
        { kind: "accent", text: "answered every lead" },
      ],
    });
    const { container } = render(<IdentityStatus agentKey="alex" />);
    // Both the plain text and the accent segment should be in the DOM.
    // The paragraph contains multiple child nodes so we check by textContent.
    const verdictPara = container.querySelector("p[class*='verdictText']");
    expect(verdictPara).not.toBeNull();
    expect(verdictPara?.textContent).toContain("Steady morning — ");
    expect(verdictPara?.textContent).toContain("answered every lead");
    // Full joined sentence is present
    expect(verdictPara?.textContent).toBe("Steady morning — answered every lead");
  });

  it("accent segments are rendered as emphasis, not plain text", () => {
    greetingData = makeGreeting({
      segments: [
        { kind: "text", text: "Looking good. " },
        { kind: "accent", text: "Riley beat CPL target" },
      ],
    });
    const { container } = render(<IdentityStatus agentKey="riley" />);
    // accent should be inside an <em> element with the verdictAccent class
    const em = container.querySelector("em[class*='verdictAccent']");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("Riley beat CPL target");
  });

  it("(b) health primary + presence secondary from a fresh signal (oldestOpenItemAgeHours < threshold)", () => {
    // alex threshold = 24h; oldest=2h < 24h → health="Nothing old is waiting"
    greetingData = makeGreeting({ oldestOpenItemAgeHours: 2 });
    // lastActionAt 10m ago from render time — presence="Last action 10m ago" or similar
    statesData = [makeState({ agentRole: "responder", lastActionAt: "2026-05-26T13:50:00Z" })];
    render(<IdentityStatus agentKey="alex" />);
    expect(screen.getByText("Nothing old is waiting")).toBeInTheDocument();
    // Presence line is shown (exact text depends on current time; just assert it exists)
    const presenceLine = screen.queryByText(/Last action/i);
    // Presence is present when lastActionAt is recent
    expect(presenceLine).not.toBeNull();
  });

  it("(c) oldestOpenItemAgeHours == null → presence-only, NO fabricated health copy", () => {
    greetingData = makeGreeting({ oldestOpenItemAgeHours: null });
    statesData = [makeState({ agentRole: "responder", lastActionAt: "2026-05-26T13:50:00Z" })];
    render(<IdentityStatus agentKey="alex" />);
    // Health lines that should NOT appear when signal is null
    expect(screen.queryByText("Nothing old is waiting")).not.toBeInTheDocument();
    expect(screen.queryByText(/Oldest lead has waited/i)).not.toBeInTheDocument();
    // Presence line IS shown
    expect(screen.queryByText(/Last action/i)).not.toBeNull();
  });

  it("(d) halted:true → 'Paused' badge + 'Paused from your workspace controls', NO health read", () => {
    haltedValue = true;
    greetingData = makeGreeting({ oldestOpenItemAgeHours: 2 });
    render(<IdentityStatus agentKey="alex" />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Paused from your workspace controls")).toBeInTheDocument();
    // Health copy must NOT appear when halted
    expect(screen.queryByText("Nothing old is waiting")).not.toBeInTheDocument();
    expect(screen.queryByText(/Oldest lead has waited/i)).not.toBeInTheDocument();
  });

  it("missing/empty segments → 'No update yet' fallback", () => {
    greetingData = makeGreeting({ segments: [] });
    render(<IdentityStatus agentKey="alex" />);
    expect(screen.getByText("No update yet")).toBeInTheDocument();
  });

  it("greeting not yet loaded → 'No update yet' fallback (undefined data)", () => {
    greetingData = undefined;
    render(<IdentityStatus agentKey="alex" />);
    expect(screen.getByText("No update yet")).toBeInTheDocument();
  });

  it("greeting fetch error → graceful fallback, never a fabricated verdict", () => {
    greetingIsError = true;
    greetingData = undefined;
    render(<IdentityStatus agentKey="alex" />);
    expect(screen.getByText("No update yet")).toBeInTheDocument();
    expect(screen.queryByText("Nothing old is waiting")).not.toBeInTheDocument();
  });

  it("does NOT render the agent identity row — the panel SheetHeader owns avatar/name/role", () => {
    // Identity used to be duplicated here and in the SheetHeader. This slot now
    // leads with the status line + verdict; the header is the sole identity.
    render(<IdentityStatus agentKey="riley" />);
    expect(screen.queryByTestId("agent-avatar")).not.toBeInTheDocument();
    expect(screen.queryByText("Ad optimizer")).not.toBeInTheDocument();
  });
});
