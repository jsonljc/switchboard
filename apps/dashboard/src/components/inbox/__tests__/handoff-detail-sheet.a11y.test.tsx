import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";
import { checkA11y } from "@/test-a11y";

// The handoff detail sheet is the human-escalation surface (a first-class trust
// invariant). Its dialog must be named in EVERY state — including the skeleton
// and fetch-error states, which render no title and so rely on the shell's
// aria-label fallback.

let detailState: { data?: unknown; isLoading: boolean; isError: boolean; refetch: () => void };

vi.mock("@/hooks/use-escalation-detail", () => ({
  useEscalationDetail: () => detailState,
}));
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

import { HandoffDetailSheet } from "../handoff-detail-sheet";

const NOW = new Date("2026-05-25T09:42:00Z").getTime();

function richPayload() {
  return {
    escalation: {
      id: "esc_9",
      reason: "complex_objection",
      status: "pending",
      slaDeadlineAt: "2026-05-25T09:53:00Z",
      leadSnapshot: {
        name: "Maya Reyes",
        channel: "WhatsApp",
        serviceInterest: "Lip filler combo",
        phone: "+1 (415) 555-0117",
      },
      qualificationSnapshot: { qualificationStage: "Booking-intent", leadScore: 78 },
      conversationSummary: {
        turnCount: 8,
        keyTopics: ["Pricing", "Combo discount"],
        objectionHistory: ["Glow quoted me $900."],
        sentiment: "Frustrated",
        suggestedOpening: "Hi Maya — Dana here.",
      },
    },
    conversationHistory: [
      { role: "user", text: "Why is yours $300 more?", timestamp: "2026-05-25T09:30:00Z" },
      {
        role: "assistant",
        text: "Our combo includes the brow lift.",
        timestamp: "2026-05-25T09:32:00Z",
      },
      { role: "owner", text: "Let me explain the difference.", timestamp: "2026-05-25T09:35:00Z" },
    ],
  };
}

function makeDecision(): Decision {
  return {
    id: "dec_h1",
    kind: "handoff",
    agentKey: "alex",
    humanSummary: "Maya is price-shopping the combo.",
    presentation: { primaryLabel: "", secondaryLabel: "", dismissLabel: "", dataLines: [] },
    urgencyScore: 90,
    createdAt: "2026-05-25T09:30:00Z",
    threadHref: null,
    sourceRef: { kind: "handoff", sourceId: "esc_9" },
    meta: { slaDeadlineAt: "2026-05-25T09:53:00Z" },
  };
}

function renderSheet() {
  return render(
    <HandoffDetailSheet
      decision={makeDecision()}
      nowMs={NOW}
      onReply={() => Promise.resolve({ delivered: true })}
      onResolve={() => Promise.resolve()}
      onClose={vi.fn()}
    />,
  );
}

describe("HandoffDetailSheet — accessibility", () => {
  it("loaded state has no axe violations", async () => {
    detailState = { data: richPayload(), isLoading: false, isError: false, refetch: vi.fn() };
    const { container } = renderSheet();
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("loading skeleton has no axe violations (dialog named via aria-label fallback)", async () => {
    detailState = { isLoading: true, isError: false, refetch: vi.fn() };
    const { container } = renderSheet();
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("fetch-error state has no axe violations (dialog named via aria-label fallback)", async () => {
    detailState = { isLoading: false, isError: true, refetch: vi.fn() };
    const { container } = renderSheet();
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
