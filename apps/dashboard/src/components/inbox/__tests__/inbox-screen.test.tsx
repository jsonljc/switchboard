import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Decision, RiskContract } from "@/lib/decisions/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const refetchMock = vi.fn();

// Controllable per-test: branches on agentKey arg
let feedByKey: (agentKey: string | null) => {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: (agentKey: string | null) => feedByKey(agentKey),
}));

vi.mock("@/hooks/use-recommendation-action", () => ({
  useRecommendationAction: () => ({
    primary: vi.fn(() => Promise.resolve({})),
    secondary: vi.fn(() => Promise.resolve({})),
    dismiss: vi.fn(() => Promise.resolve({})),
    confirm: vi.fn(() => Promise.resolve({})),
    undo: vi.fn(() => Promise.resolve({})),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Mock heavy deps to avoid sprite/canvas noise
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

// Import component after mocks are set up
import { InboxScreen } from "../inbox-screen";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const lowContract: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: `dec-${Math.random().toString(36).slice(2)}`,
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
    sourceRef: { kind: "approval", sourceId: `rec-${Math.random().toString(36).slice(2)}` },
    meta: { contactName: "Maya R.", riskContract: lowContract },
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<Decision> = {}): Decision {
  return {
    id: `dec-handoff-${Math.random().toString(36).slice(2)}`,
    kind: "handoff",
    agentKey: "riley",
    humanSummary: "Client wants to renegotiate their retainer — over to you.",
    presentation: {
      primaryLabel: "Take this one",
      secondaryLabel: "Snooze",
      dismissLabel: "Mark resolved",
      dataLines: [],
    },
    urgencyScore: 0.8,
    createdAt: new Date().toISOString(),
    threadHref: null,
    sourceRef: { kind: "handoff", sourceId: `esc-${Math.random().toString(36).slice(2)}` },
    meta: { slaDeadlineAt: new Date(Date.now() + 45 * 60000).toISOString() },
    ...overrides,
  };
}

// Shared test decisions
const alexDecision = makeDecision({ id: "dec-alex-1", agentKey: "alex" });
const rileyHandoff = makeHandoff({ id: "dec-riley-1", agentKey: "riley" });
const rileyDecision = makeDecision({
  id: "dec-riley-2",
  agentKey: "riley",
  humanSummary: "Should I follow up with the Riley client?",
  presentation: {
    primaryLabel: "Yes, follow up",
    secondaryLabel: "Not yet",
    dismissLabel: "Dismiss",
    dataLines: [],
  },
});

const allDecisions = [alexDecision, rileyHandoff, rileyDecision];

function successFeed(decisions: Decision[]) {
  return {
    data: { decisions, counts: { total: decisions.length, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
    refetch: refetchMock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("<InboxScreen>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: populated success state for both filtered and unfiltered feeds
    feedByKey = (_agentKey) => successFeed(allDecisions);
  });

  // Test 1: isError before empty — regression guard
  describe("(1) isError renders error state, NOT empty state", () => {
    it("renders InboxErrorState when feed errors and does not render empty copy", () => {
      feedByKey = (_agentKey) => ({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: refetchMock,
      });

      render(<InboxScreen />);

      expect(screen.getByText(/couldn't load your inbox/i)).toBeInTheDocument();
      expect(screen.queryByText(/that's everything/i)).toBeNull();
    });

    it("calls refetch when Try again is clicked", () => {
      feedByKey = (_agentKey) => ({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: refetchMock,
      });

      render(<InboxScreen />);

      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // Test 2: isLoading
  describe("(2) isLoading renders loading affordance", () => {
    it("renders loading text, not empty or error copy", () => {
      feedByKey = (_agentKey) => ({
        data: undefined,
        isLoading: true,
        isError: false,
        refetch: refetchMock,
      });

      render(<InboxScreen />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
      expect(screen.queryByText(/that's everything/i)).toBeNull();
      expect(screen.queryByText(/couldn't load your inbox/i)).toBeNull();
    });
  });

  // Test 3: empty unfiltered
  describe("(3) empty unfiltered state", () => {
    it("renders InboxEmptyState with unfiltered copy when decisions list is empty", () => {
      feedByKey = (_agentKey) => successFeed([]);

      render(<InboxScreen />);

      expect(screen.getByText(/that's everything/i)).toBeInTheDocument();
    });
  });

  // Test 4: populated
  describe("(4) populated feed", () => {
    it("renders one InboxDecisionItem per decision", () => {
      feedByKey = (_agentKey) => successFeed(allDecisions);

      render(<InboxScreen />);

      // Each decision card renders its humanSummary as the title
      expect(screen.getByText("Should I send Maya the membership comparison?")).toBeInTheDocument();
      expect(
        screen.getByText("Client wants to renegotiate their retainer — over to you."),
      ).toBeInTheDocument();
      expect(screen.getByText("Should I follow up with the Riley client?")).toBeInTheDocument();
    });

    it("derives per-agent counts from the unfiltered feed for the filter row", () => {
      // alex=1 approval, riley=2 (1 handoff + 1 approval)
      feedByKey = (_agentKey) => successFeed(allDecisions);

      render(<InboxScreen />);

      // Filter row chips should have counts from the unfiltered decisions
      // Alex chip should show 1, Riley chip should show 2
      // Chips are buttons with aria-pressed and contain label + count
      const alexChip = screen.getByRole("button", { name: /Alex/ });
      const rileyChip = screen.getByRole("button", { name: /Riley/ });

      // Assert the actual count VALUES, not just chip presence — an all-zeros
      // regression in the counts derivation must fail this test (day-one chips
      // render even at count 0, so presence alone would not catch it).
      expect(within(alexChip).getByText("1")).toBeInTheDocument();
      expect(within(rileyChip).getByText("2")).toBeInTheDocument();

      // The "All" chip shows total = 3
      const allChip = screen.getByRole("button", { name: /All/ });
      expect(within(allChip).getByText("3")).toBeInTheDocument();
    });
  });

  // Test 5: filter switch
  describe("(5) filter switch", () => {
    it("switching to Riley filter shows only riley decisions", async () => {
      const rileyOnly = [rileyHandoff, rileyDecision];

      feedByKey = (agentKey) => {
        if (agentKey === "riley") return successFeed(rileyOnly);
        return successFeed(allDecisions);
      };

      render(<InboxScreen />);

      // Initially all decisions visible
      expect(screen.getByText("Should I send Maya the membership comparison?")).toBeInTheDocument();

      // Click the Riley chip
      const rileyChip = screen.getByRole("button", { name: /Riley/ });
      fireEvent.click(rileyChip);

      // After filter: only riley decisions visible
      await vi.waitFor(() => {
        expect(screen.queryByText("Should I send Maya the membership comparison?")).toBeNull();
        expect(
          screen.getByText("Client wants to renegotiate their retainer — over to you."),
        ).toBeInTheDocument();
      });
    });
  });

  // Test 6: open approval detail
  describe("(6) open approval detail sheet", () => {
    it("renders the ApprovalDetailSheet when an approval card's Why is clicked", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);

      render(<InboxScreen />);

      // The Why button on the approval card
      const whyBtn = screen.getByRole("button", { name: /why/i });
      fireEvent.click(whyBtn);

      // ApprovalDetailSheet renders with role="dialog"
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // It contains "needs your okay"
      expect(screen.getByText(/needs your okay/i)).toBeInTheDocument();
    });
  });

  // Test 7: handoff detail → GUARD
  describe("(7) handoff detail renders guard, no dialog, no crash", () => {
    it("renders the guard placeholder when a handoff card's primary is clicked", () => {
      feedByKey = (_agentKey) => successFeed([rileyHandoff]);

      render(<InboxScreen />);

      // The primary button on the handoff card is "Take this one"
      const takeOverBtn = screen.getByRole("button", { name: "Take this one" });
      fireEvent.click(takeOverBtn);

      // Guard text renders
      expect(screen.getByText("Handoff detail coming next.")).toBeInTheDocument();
      // No dialog
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not crash when a handoff's Why button is clicked", () => {
      feedByKey = (_agentKey) => successFeed([rileyHandoff]);

      render(<InboxScreen />);

      const whyBtn = screen.getByRole("button", { name: /why/i });
      fireEvent.click(whyBtn);

      expect(screen.getByText("Handoff detail coming next.")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
