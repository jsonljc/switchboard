import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";

const refetchMock = vi.fn();
let detailState: {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

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

function makeDecision(overrides: Partial<Decision> = {}): Decision {
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
    ...overrides,
  };
}

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
      { role: "owner", text: "Let me explain the difference.", timestamp: "2026-05-25T09:35:00Z" },
    ],
  };
}

const noop = () => Promise.resolve({ delivered: true });
const noopResolve = () => Promise.resolve();

beforeEach(() => {
  refetchMock.mockReset();
  detailState = { isLoading: false, isError: false, refetch: refetchMock };
});

describe("HandoffDetailSheet — states", () => {
  it("renders the skeleton while loading", () => {
    detailState = { isLoading: true, isError: false, refetch: refetchMock };
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId("handoff-skeleton")).toBeInTheDocument();
  });

  it("renders the fetch error with a retry that calls refetch", () => {
    detailState = { isLoading: false, isError: true, refetch: refetchMock };
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetchMock).toHaveBeenCalled();
  });
});

describe("HandoffDetailSheet — data render", () => {
  beforeEach(() => {
    detailState = { data: richPayload(), isLoading: false, isError: false, refetch: refetchMock };
  });

  it("maps the reason enum to a plain-English chip", () => {
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText("Tricky objection")).toBeInTheDocument();
    expect(screen.getByText(/is handing this to you/i)).toBeInTheDocument();
  });

  it("renders the lead snapshot when present", () => {
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText("Maya Reyes")).toBeInTheDocument();
    expect(screen.getByText(/Lip filler combo/)).toBeInTheDocument();
  });

  it("maps turn roles: user → lead first name, owner → agent name; uses text not content", () => {
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    const thread = screen.getByTestId("handoff-thread");
    expect(within(thread).getByText("Why is yours $300 more?")).toBeInTheDocument();
    expect(within(thread).getByText("Maya")).toBeInTheDocument();
    expect(within(thread).getByText("Alex")).toBeInTheDocument();
  });

  it("renders where-it-stands topics / objections / suggested opening when present", () => {
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText(/Glow quoted me \$900\./)).toBeInTheDocument();
    expect(screen.getByText(/Hi Maya — Dana here\./)).toBeInTheDocument();
  });

  it("degrades when snapshots are empty — still shows reason, SLA, and live thread", () => {
    detailState = {
      data: {
        escalation: {
          id: "esc_9",
          reason: "human_requested",
          status: "pending",
          slaDeadlineAt: "2026-05-25T09:53:00Z",
          leadSnapshot: { channel: "WhatsApp" },
          conversationSummary: {},
        },
        conversationHistory: [
          { role: "user", text: "Can I talk to a person?", timestamp: "2026-05-25T09:40:00Z" },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: refetchMock,
    };
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText("They asked for you")).toBeInTheDocument();
    expect(screen.getByText("Can I talk to a person?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start with this/i })).not.toBeInTheDocument();
  });

  it("tolerates an unknown turn role without crashing", () => {
    detailState = {
      data: {
        escalation: {
          id: "esc_9",
          reason: "human_requested",
          status: "pending",
          conversationSummary: {},
        },
        conversationHistory: [
          { role: "system", text: "session reset", timestamp: "2026-05-25T09:00:00Z" },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: refetchMock,
    };
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText("session reset")).toBeInTheDocument();
  });
});

describe("HandoffDetailSheet — reply & resolve", () => {
  beforeEach(() => {
    detailState = { data: richPayload(), isLoading: false, isError: false, refetch: refetchMock };
  });

  it("loads the suggested opening into the composer", () => {
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={noopResolve}
        onClose={() => {}}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start with this/i }));
    expect(screen.getByPlaceholderText(/Write to Maya/)).toHaveValue("Hi Maya — Dana here.");
  });

  it("sends the reply and closes when delivered", async () => {
    const onReply = vi.fn(() => Promise.resolve({ delivered: true }));
    const onClose = vi.fn();
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={onReply}
        onResolve={noopResolve}
        onClose={onClose}
        nowMs={NOW}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Write to Maya/), {
      target: { value: "On a call now." },
    });
    fireEvent.click(screen.getByRole("button", { name: /hand back to Alex/i }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("On a call now."));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the sheet open and shows the saved-but-undelivered banner on 502", async () => {
    const onReply = vi.fn(() => Promise.resolve({ delivered: false }));
    const onClose = vi.fn();
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={onReply}
        onResolve={noopResolve}
        onClose={onClose}
        nowMs={NOW}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Write to Maya/), { target: { value: "Hi." } });
    fireEvent.click(screen.getByRole("button", { name: /hand back to Alex/i }));
    await waitFor(() => expect(screen.getByText(/couldn't deliver/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the resolve note, resolves, and closes", async () => {
    const onResolve = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    const { container } = render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={onResolve}
        onClose={onClose}
        nowMs={NOW}
      />,
    );
    // Footer toggle opens the resolve-note section.
    fireEvent.click(screen.getByRole("button", { name: /^mark resolved$/i }));
    fireEvent.change(screen.getByPlaceholderText(/note what you did/i), {
      target: { value: "Closed by phone." },
    });
    // Confirm button is the one INSIDE the resolve section (not the footer toggle).
    const resolveSection = container.querySelector(".ds-resolve-section") as HTMLElement;
    fireEvent.click(within(resolveSection).getByRole("button", { name: /^mark resolved$/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("Closed by phone."));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an honest 'not saved' error and stays open when reply rejects", async () => {
    const onReply = vi.fn(() => Promise.reject(new Error("network down")));
    const onClose = vi.fn();
    render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={onReply}
        onResolve={noopResolve}
        onClose={onClose}
        nowMs={NOW}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Write to Maya/), { target: { value: "Hi." } });
    fireEvent.click(screen.getByRole("button", { name: /hand back to Alex/i }));
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    // draft retained for retry
    expect(screen.getByPlaceholderText(/Write to Maya/)).toHaveValue("Hi.");
  });

  it("shows a resolve error and stays open when resolve rejects", async () => {
    const onResolve = vi.fn(() => Promise.reject(new Error("boom")));
    const onClose = vi.fn();
    const { container } = render(
      <HandoffDetailSheet
        decision={makeDecision()}
        onReply={noop}
        onResolve={onResolve}
        onClose={onClose}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^mark resolved$/i }));
    const resolveSection = container.querySelector(".ds-resolve-section") as HTMLElement;
    fireEvent.click(within(resolveSection).getByRole("button", { name: /^mark resolved$/i }));
    await waitFor(() =>
      expect(within(resolveSection).getByText(/couldn't mark this resolved/i)).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
