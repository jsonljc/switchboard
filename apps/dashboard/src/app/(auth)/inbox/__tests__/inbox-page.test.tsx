import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Decision, RiskContract } from "@/lib/decisions/types";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: vi.fn(),
}));

// Per-card hooks — NeedsYouCard owns one useRecommendationAction per card.
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

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { useDecisionFeed } from "@/hooks/use-decision-feed";
import InboxPage from "../page";

const mockFeed = useDecisionFeed as ReturnType<typeof vi.fn>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const lowContract: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

const financialContract: RiskContract = {
  ...lowContract,
  financialEffect: true,
};

function makeDecision(id: string, summary: string, contract?: RiskContract): Decision {
  return {
    id,
    kind: "approval",
    agentKey: "alex",
    humanSummary: summary,
    presentation: {
      primaryLabel: "Approve",
      secondaryLabel: "Skip",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 80,
    createdAt: new Date().toISOString(),
    threadHref: null,
    sourceRef: { kind: "approval", sourceId: id },
    meta: { riskContract: contract },
  };
}

describe("InboxPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders loading state", () => {
    mockFeed.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<InboxPage />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("renders error state and NOT the empty state", () => {
    mockFeed.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<InboxPage />);
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText(/That's everything/i)).toBeNull();
  });

  it("renders empty state when there are no decisions", () => {
    mockFeed.mockReturnValue({
      data: { decisions: [] },
      isLoading: false,
      isError: false,
    });
    render(<InboxPage />);
    // Pagehead count + empty-state both say "That's everything"; target the heading.
    expect(screen.getByRole("heading", { name: /that's everything/i })).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).toBeNull();
  });

  it("renders decision list when decisions are present", () => {
    mockFeed.mockReturnValue({
      data: {
        decisions: [
          makeDecision("d1", "Approve campaign spend", lowContract),
          makeDecision("d2", "Review ad copy", lowContract),
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(<InboxPage />);
    expect(screen.getByText("Approve campaign spend")).toBeInTheDocument();
    expect(screen.getByText("Review ad copy")).toBeInTheDocument();
    expect(screen.queryByText(/That's everything/i)).toBeNull();
    expect(screen.queryByText(/Couldn't load your inbox/i)).toBeNull();
  });

  // ── Risk-gate assertion (E5b) — the swipe-policy gate must be in force on Inbox ──

  it("a financialEffect:true decision is NOT swipe-approvable in the Inbox", () => {
    mockFeed.mockReturnValue({
      data: {
        decisions: [makeDecision("d1", "Approve budget move", financialContract)],
      },
      isLoading: false,
      isError: false,
    });
    render(<InboxPage />);
    // InboxDecisionCard exposes data-swipe-approve on the track element.
    const track = document.querySelector("[data-swipe-track]") as HTMLElement;
    expect(track).toHaveAttribute("data-swipe-approve", "false");
    // The decision summary is still rendered.
    expect(screen.getByText("Approve budget move")).toBeInTheDocument();
  });

  it("a pure low-risk decision IS swipe-approvable in the Inbox", () => {
    mockFeed.mockReturnValue({
      data: {
        decisions: [makeDecision("d1", "Send intro email", lowContract)],
      },
      isLoading: false,
      isError: false,
    });
    render(<InboxPage />);
    const track = document.querySelector("[data-swipe-track]") as HTMLElement;
    expect(track).toHaveAttribute("data-swipe-approve", "true");
  });
});
