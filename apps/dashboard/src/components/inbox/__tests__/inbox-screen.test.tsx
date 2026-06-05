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

const wfApproveMock = vi.fn(() => Promise.resolve({ executionResult: { success: true } }));
const wfRejectMock = vi.fn(() => Promise.resolve({}));
const wfCtor = vi.fn(); // captures the lifecycle id arg
vi.mock("@/hooks/use-workflow-approval-action", () => ({
  useWorkflowApprovalAction: (id: string) => {
    wfCtor(id);
    return {
      approve: wfApproveMock,
      reject: wfRejectMock,
      isPending: false,
      error: null,
    };
  },
}));

vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const invalidateQueriesMock = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  };
});

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    decisions: { all: () => ["org1", "decisions"] },
    escalations: { all: () => ["org1", "escalations"] },
  }),
}));

const escalationDetailState = {
  data: {
    escalation: {
      id: "esc_9",
      reason: "human_requested",
      status: "pending",
      conversationSummary: {},
      leadSnapshot: { channel: "WhatsApp" },
    },
    conversationHistory: [],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock("@/hooks/use-escalation-detail", () => ({
  useEscalationDetail: () => escalationDetailState,
}));
const sendMock = vi.fn(() => Promise.resolve({ ok: true, escalation: { id: "esc_9" } }));
const resolveMock = vi.fn(() => Promise.resolve());
vi.mock("@/hooks/use-escalation-reply", () => ({
  useEscalationReply: () => ({ send: sendMock, isPending: false }),
}));
vi.mock("@/hooks/use-escalation-resolve", () => ({
  useEscalationResolve: () => ({ resolve: resolveMock, isPending: false }),
}));

// Mock heavy deps to avoid sprite/canvas noise
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

// AgentPanel is tested independently; mock it so InboxScreen wiring tests stay focused.
vi.mock("@/components/agent-panel/agent-panel", () => ({
  AgentPanel: ({
    agentKey,
    open,
    onOpenChange,
    onSeeAll,
    onOpenDecision,
    onActivate,
  }: {
    agentKey: string;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onSeeAll?: () => void;
    onOpenDecision?: () => void;
    onActivate?: () => void;
  }) =>
    open ? (
      <div role="dialog" data-testid={`mock-agent-panel-${agentKey}`}>
        <button onClick={() => onOpenChange(false)} data-testid="mock-panel-close">
          Close
        </button>
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

const handoffDecision = makeHandoff({
  id: "dec_h1",
  agentKey: "riley",
  humanSummary: "Maya is price-shopping the combo.",
  sourceRef: { kind: "handoff", sourceId: "esc_9" },
  meta: { slaDeadlineAt: "2026-05-25T09:53:00Z" },
});

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
    pushMock.mockClear();
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

      expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
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
      expect(screen.queryByText(/couldn't load/i)).toBeNull();
    });
  });

  // Test 3: empty unfiltered
  describe("(3) empty unfiltered state", () => {
    it("renders InboxEmptyState with unfiltered copy when decisions list is empty", () => {
      feedByKey = (_agentKey) => successFeed([]);

      render(<InboxScreen />);

      // The pagehead count and the empty-state both say "That's everything";
      // target the empty-state heading specifically to disambiguate.
      expect(screen.getByRole("heading", { name: /that's everything/i })).toBeInTheDocument();
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
      // Use the filter group to scope — avoids ambiguity with avatar buttons in the list.
      const filterGroup = screen.getByRole("group", { name: /filter by teammate/i });
      const alexChip = within(filterGroup).getByRole("button", { name: /Alex/ });
      const rileyChip = within(filterGroup).getByRole("button", { name: /Riley/ });

      // Assert the actual count VALUES, not just chip presence — an all-zeros
      // regression in the counts derivation must fail this test (day-one chips
      // render even at count 0, so presence alone would not catch it).
      expect(within(alexChip).getByText("1")).toBeInTheDocument();
      expect(within(rileyChip).getByText("2")).toBeInTheDocument();

      // The "All" chip shows total = 3
      const allChip = within(filterGroup).getByRole("button", { name: /All/ });
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

      // Click the Riley filter chip (scope to filter group to avoid ambiguity with avatar buttons)
      const filterGroup = screen.getByRole("group", { name: /filter by teammate/i });
      const rileyChip = within(filterGroup).getByRole("button", { name: /Riley/ });
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
    it("opens the ApprovalDetailSheet when the approval card is tapped", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);

      const { container } = render(<InboxScreen />);

      // The doorway card opens its detail on a whole-card tap (no inline buttons).
      const cardBody = container.querySelector("[data-card-body]") as HTMLElement;
      fireEvent.click(cardBody);

      // ApprovalDetailSheet renders role="dialog" with "needs your okay" copy.
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("data-kind", "approval");
      expect(screen.getByText(/needs your okay/i)).toBeInTheDocument();
    });
  });

  // Test 7: handoff detail sheet (replaces guard)
  describe("(7) handoff detail sheet opens when a handoff card is tapped", () => {
    it("opens the handoff detail sheet when a handoff card is tapped (no guard placeholder)", () => {
      feedByKey = () => ({
        data: { decisions: [handoffDecision] },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      const { container } = render(<InboxScreen />);

      // Handoffs are tap-only; a whole-card tap opens the detail sheet.
      const cardBody = container.querySelector("[data-card-body]") as HTMLElement;
      fireEvent.click(cardBody);

      expect(screen.queryByText(/handoff detail coming next/i)).not.toBeInTheDocument();
      // HandoffDetailSheet renders role="dialog"; the card also renders "is handing this to you"
      // so assert via the dialog role to avoid getByText ambiguity
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("data-kind", "handoff");
    });
  });

  // Test 8: agent avatar opens agent panel
  describe("(8) agent avatar button opens the agent panel", () => {
    it("panel is absent before interaction", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("clicking the agent avatar button opens the agent panel for that agent", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);

      // The avatar button is labelled "Open Alex panel"
      const avatarBtn = screen.getByRole("button", { name: /open alex panel/i });
      fireEvent.click(avatarBtn);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
    });

    it("clicking riley's avatar button opens the riley panel", () => {
      feedByKey = (_agentKey) => successFeed([rileyHandoff]);
      render(<InboxScreen />);

      const avatarBtn = screen.getByRole("button", { name: /open riley panel/i });
      fireEvent.click(avatarBtn);

      expect(screen.getByTestId("mock-agent-panel-riley")).toBeInTheDocument();
    });

    it("closing the panel clears it (dialog gone)", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);

      fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("mock-panel-close"));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("onSeeAll navigates to /results", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);

      fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
      fireEvent.click(screen.getByTestId("mock-see-all"));
      expect(pushMock).toHaveBeenCalledWith("/results");
    });

    it("onOpenDecision navigates to /inbox (already on inbox surface)", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);

      fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
      fireEvent.click(screen.getByTestId("mock-open-decision"));
      expect(pushMock).toHaveBeenCalledWith("/inbox");
    });

    it("onActivate navigates to /settings/channels", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);

      fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
      fireEvent.click(screen.getByTestId("mock-activate"));
      expect(pushMock).toHaveBeenCalledWith("/settings/channels");
    });

    // (8f) stopPropagation contract: avatar click opens panel, never decision-detail
    it("clicking the avatar opens the agent panel and does NOT open decision-detail", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);
      render(<InboxScreen />);

      const avatarBtn = screen.getByRole("button", { name: /open alex panel/i });
      fireEvent.click(avatarBtn);

      // Agent panel dialog is present
      expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
      // Decision-detail (ApprovalDetailSheet) must NOT be open — its sentinel
      // text "needs your okay" must be absent, proving stopPropagation worked.
      expect(screen.queryByText(/needs your okay/i)).toBeNull();
    });
  });

  // Test 9: scrim backdrop closes an open detail sheet
  describe("(9) scrim closes the open detail sheet", () => {
    it("clicking the scrim backdrop closes the detail sheet", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);

      const { container } = render(<InboxScreen />);

      // Open the approval detail via a whole-card tap.
      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // The scrim backdrop (aria-hidden) closes the sheet on click.
      const scrim = container.querySelector(".scrim") as HTMLElement;
      expect(scrim).toBeInTheDocument();
      fireEvent.click(scrim);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  // Test 10: Escape closes the open detail sheet (aria-modal convention)
  describe("(11) workflow approval cards: detail-only actions through the lifecycle hook", () => {
    const workflowDecision = makeDecision({
      id: "workflow_approval:lc-1",
      kind: "workflow_approval",
      agentKey: "riley",
      humanSummary: "Riley wants to brief Mira to refresh creative on campaign camp-1.",
      presentation: {
        primaryLabel: "Approve handoff",
        secondaryLabel: "Not now",
        dismissLabel: "Reject",
        dataLines: ["Evidence: 1000 clicks"],
      },
      sourceRef: { kind: "workflow_approval", sourceId: "lc-1" },
      meta: {
        bindingHash: "hash-1",
        riskContract: {
          riskLevel: "medium",
          externalEffect: false,
          financialEffect: false,
          clientFacing: false,
          requiresConfirmation: true,
        },
      },
    });

    it("opens the detail sheet and approve carries the bindingHash through the confirm flow", async () => {
      feedByKey = () => successFeed([workflowDecision]);
      const { container } = render(<InboxScreen />);

      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(wfCtor).toHaveBeenCalledWith("lc-1");

      // requiresConfirmation -> primary shows the confirm step first.
      fireEvent.click(screen.getByRole("button", { name: /Approve handoff…/ }));
      fireEvent.click(screen.getByRole("button", { name: /Yes, approve handoff/i }));

      await Promise.resolve();
      expect(wfApproveMock).toHaveBeenCalledWith("hash-1", undefined);
    });

    it("Reject fires the lifecycle reject", async () => {
      feedByKey = () => successFeed([workflowDecision]);
      const { container } = render(<InboxScreen />);

      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));

      await Promise.resolve();
      expect(wfRejectMock).toHaveBeenCalled();
      expect(wfApproveMock).not.toHaveBeenCalled();
    });

    it("a dispatchFailed decision presents Retry as the primary action", () => {
      const retryDecision = {
        ...workflowDecision,
        presentation: { ...workflowDecision.presentation, primaryLabel: "Retry" },
        meta: { ...workflowDecision.meta, dispatchFailed: true },
      };
      feedByKey = () => successFeed([retryDecision]);
      const { container } = render(<InboxScreen />);

      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      expect(screen.getByRole("button", { name: /Retry…/ })).toBeInTheDocument();
    });

    it("refuses approve when the bindingHash is missing (degraded card)", async () => {
      const degraded = {
        ...workflowDecision,
        meta: { ...workflowDecision.meta, bindingHash: undefined },
      };
      feedByKey = () => successFeed([degraded]);
      const { container } = render(<InboxScreen />);

      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      fireEvent.click(screen.getByRole("button", { name: /Approve handoff…/ }));
      fireEvent.click(screen.getByRole("button", { name: /Yes, approve handoff/i }));

      await Promise.resolve();
      expect(wfApproveMock).not.toHaveBeenCalled();
    });
  });

  describe("(10) Escape closes the open detail sheet", () => {
    it("closes the detail sheet on an Escape keydown", () => {
      feedByKey = (_agentKey) => successFeed([alexDecision]);

      const { container } = render(<InboxScreen />);
      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
