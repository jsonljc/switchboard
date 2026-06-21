import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Decision, RiskContract } from "@/lib/decisions/types";

// ── Mock heavy dependencies ───────────────────────────────────────────────────

vi.mock("../inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

const confirmContract: RiskContract = {
  ...lowContract,
  requiresConfirmation: true,
};

const FIXED_NOW = 1_700_000_000_000; // fixed ms for deterministic time tests

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Yes, send it",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 0.8,
    createdAt: new Date(FIXED_NOW - 2 * 60 * 60 * 1000).toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { contactName: "Maya R.", riskContract: lowContract },
    ...overrides,
  };
}

// Import after mocks are set up
import { ApprovalDetailSheet } from "../approval-detail-sheet";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHandlers() {
  return {
    onClose: vi.fn(),
    onCommit: vi.fn(),
    onSecondary: vi.fn(),
    onDismiss: vi.fn(),
  };
}

function renderSheet(
  decision: Decision,
  extra: Partial<Parameters<typeof ApprovalDetailSheet>[0]> = {},
) {
  const handlers = makeHandlers();
  const utils = render(
    <ApprovalDetailSheet decision={decision} nowMs={FIXED_NOW} {...handlers} {...extra} />,
  );
  return { ...utils, ...handlers };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("<ApprovalDetailSheet>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (a) basic rendering: humanSummary, head, agent name, risk pill
  describe("(a) basic rendering", () => {
    it("renders the humanSummary", () => {
      renderSheet(makeDecision());
      expect(screen.getByText("Should I send Maya the membership comparison?")).toBeInTheDocument();
    });

    it("renders the 'needs your okay' head text", () => {
      renderSheet(makeDecision());
      expect(screen.getByText("needs your okay")).toBeInTheDocument();
    });

    it("renders the agent display name (Alex for agentKey=alex)", () => {
      renderSheet(makeDecision());
      expect(screen.getByText("Alex")).toBeInTheDocument();
    });

    it("renders a 'low risk' pill for a low riskContract", () => {
      renderSheet(makeDecision({ meta: { riskContract: lowContract } }));
      expect(screen.getByText("low risk")).toBeInTheDocument();
    });

    it("renders a 'needs review' pill when riskContract is absent", () => {
      renderSheet(makeDecision({ meta: {} }));
      expect(screen.getByText("needs review")).toBeInTheDocument();
    });

    it("renders as a dialog with aria-modal", () => {
      renderSheet(makeDecision());
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    });

    it("close button has aria-label='Close detail'", () => {
      renderSheet(makeDecision());
      expect(screen.getByRole("button", { name: /close detail/i })).toBeInTheDocument();
    });

    it("calls onClose when close button is clicked", () => {
      const { onClose } = renderSheet(makeDecision());
      fireEvent.click(screen.getByRole("button", { name: /close detail/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // (b) dataLines as string[][] — flatten joined with " · "
  describe("(b) dataLines rendering", () => {
    it("renders each string[] row flattened and joined with ' · '", () => {
      renderSheet(
        makeDecision({
          presentation: {
            primaryLabel: "Yes",
            secondaryLabel: "No",
            dismissLabel: "Dismiss",
            dataLines: [["Budget", "$40/day"]],
          },
        }),
      );
      expect(screen.getByText("Budget · $40/day")).toBeInTheDocument();
    });

    it("renders multiple rows", () => {
      renderSheet(
        makeDecision({
          presentation: {
            primaryLabel: "Yes",
            secondaryLabel: "No",
            dismissLabel: "Dismiss",
            dataLines: [
              ["Budget", "$40/day"],
              ["Duration", "7 days"],
            ],
          },
        }),
      );
      expect(screen.getByText("Budget · $40/day")).toBeInTheDocument();
      expect(screen.getByText("Duration · 7 days")).toBeInTheDocument();
    });

    it("does NOT render the datalines list when dataLines is empty", () => {
      const { container } = renderSheet(
        makeDecision({
          presentation: {
            primaryLabel: "Yes",
            secondaryLabel: "No",
            dismissLabel: "Dismiss",
            dataLines: [],
          },
        }),
      );
      expect(container.querySelector(".ds-datalines")).not.toBeInTheDocument();
    });
  });

  // (c) risk chips and missing-contract block
  describe("(c) risk section", () => {
    it("renders the 'Affects your ad spend or credits' chip for financialEffect:true", () => {
      renderSheet(makeDecision({ meta: { riskContract: financialContract } }));
      expect(screen.getByText("Affects your ad spend or credits")).toBeInTheDocument();
    });

    it("renders the .ds-risk-missing block (not chip list) when contract is absent", () => {
      const { container } = renderSheet(makeDecision({ meta: {} }));
      expect(container.querySelector(".ds-risk-missing")).toBeInTheDocument();
      expect(screen.getByText(/Needs review before this can run/)).toBeInTheDocument();
    });

    it("does NOT render .ds-risk-missing when contract is present", () => {
      const { container } = renderSheet(makeDecision({ meta: { riskContract: lowContract } }));
      expect(container.querySelector(".ds-risk-missing")).not.toBeInTheDocument();
    });
  });

  // (d) undoableUntil label
  describe("(d) undoable-for label", () => {
    it("shows an 'undoable for' label when undoableUntil is in the future", () => {
      const undoableUntil = new Date(FIXED_NOW + 10 * 60 * 1000).toISOString(); // 10 min in future
      renderSheet(makeDecision({ meta: { riskContract: lowContract, undoableUntil } }));
      expect(screen.getByText(/undoable for/i)).toBeInTheDocument();
    });

    it("does NOT render an undoable label when undoableUntil is absent", () => {
      renderSheet(makeDecision({ meta: { riskContract: lowContract } }));
      expect(screen.queryByText(/undoable for/i)).not.toBeInTheDocument();
    });

    it("does NOT render an undoable label when undoableUntil is in the past", () => {
      const undoableUntil = new Date(FIXED_NOW - 5 * 60 * 1000).toISOString(); // 5 min ago
      renderSheet(makeDecision({ meta: { riskContract: lowContract, undoableUntil } }));
      expect(screen.queryByText(/undoable for/i)).not.toBeInTheDocument();
    });
  });

  // (e) threadHref link
  describe("(e) 'View conversation' link", () => {
    it("renders the 'View conversation' link when threadHref is set", () => {
      renderSheet(makeDecision({ threadHref: "/contacts/maya/conversations" }));
      expect(screen.getByText(/view conversation/i)).toBeInTheDocument();
    });

    it("does NOT render the link when threadHref is null", () => {
      renderSheet(makeDecision({ threadHref: null }));
      expect(screen.queryByText(/view conversation/i)).not.toBeInTheDocument();
    });
  });

  // (f) confirm gate
  describe("(f) confirm gate", () => {
    it("with requiresConfirmation:true, clicking primary shows ConfirmInline and does NOT call onCommit", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: { riskContract: confirmContract } }));
      fireEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      expect(onCommit).not.toHaveBeenCalled();
      // ConfirmInline appears
      expect(screen.getByPlaceholderText(/optional/i)).toBeInTheDocument();
    });

    it("with absent contract, clicking primary shows ConfirmInline (unsafe default)", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: {} }));
      fireEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      expect(onCommit).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText(/optional/i)).toBeInTheDocument();
    });

    it("typing in note textarea then clicking affirmative calls onCommit with trimmed note", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: { riskContract: confirmContract } }));
      fireEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      const textarea = screen.getByPlaceholderText(/optional/i);
      fireEvent.change(textarea, { target: { value: "  my audit note  " } });
      fireEvent.click(screen.getByRole("button", { name: /yes, yes, send it/i }));
      expect(onCommit).toHaveBeenCalledWith("my audit note");
    });

    it("with a safe contract (requiresConfirmation:false, no flags), clicking primary calls onCommit() directly with no note", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: { riskContract: lowContract } }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
      expect(onCommit).toHaveBeenCalledWith(undefined);
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("empty note in ConfirmInline calls onCommit with undefined (not empty string)", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: { riskContract: confirmContract } }));
      fireEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      // Leave note empty
      fireEvent.click(screen.getByRole("button", { name: /yes, yes, send it/i }));
      expect(onCommit).toHaveBeenCalledWith(undefined);
    });

    it("'Not now' in ConfirmInline cancels back to the main action row", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: { riskContract: confirmContract } }));
      fireEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(onCommit).not.toHaveBeenCalled();
      // Back to normal action row
      expect(screen.getByRole("button", { name: /yes, send it…/i })).toBeInTheDocument();
    });

    it("HIGH-RISK gate: riskLevel=high with requiresConfirmation:false requires confirm (canonical needsConfirm)", () => {
      const highRiskNoConfirmFlag: RiskContract = {
        riskLevel: "high",
        externalEffect: false,
        financialEffect: false,
        clientFacing: false,
        requiresConfirmation: false,
      };
      const { onCommit } = renderSheet(
        makeDecision({ meta: { riskContract: highRiskNoConfirmFlag } }),
      );
      // Primary button label should have "…" suffix because mustConfirm is true
      const primaryBtn = screen.getByRole("button", { name: /yes, send it…/i });
      expect(primaryBtn).toBeInTheDocument();
      // Clicking primary does NOT call onCommit — it opens ConfirmInline
      fireEvent.click(primaryBtn);
      expect(onCommit).not.toHaveBeenCalled();
      // ConfirmInline step appears ("One last check" copy)
      expect(screen.getByText(/one last check/i)).toBeInTheDocument();
      // Clicking the affirmative ("Yes, …") in ConfirmInline calls onCommit
      fireEvent.click(screen.getByRole("button", { name: /yes, yes, send it/i }));
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("resets confirming state when decision changes", () => {
      const dec1 = makeDecision({ id: "dec-1", meta: { riskContract: confirmContract } });
      const dec2 = makeDecision({ id: "dec-2", meta: { riskContract: confirmContract } });
      const handlers = makeHandlers();
      const { rerender } = render(
        <ApprovalDetailSheet decision={dec1} nowMs={FIXED_NOW} {...handlers} />,
      );
      fireEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      // ConfirmInline is showing
      expect(screen.getByPlaceholderText(/optional/i)).toBeInTheDocument();
      // Swap decision
      rerender(<ApprovalDetailSheet decision={dec2} nowMs={FIXED_NOW} {...handlers} />);
      // ConfirmInline should be gone
      expect(screen.queryByPlaceholderText(/optional/i)).not.toBeInTheDocument();
    });
  });

  // (g) callbacks + alreadyHandled
  describe("(g) callbacks and alreadyHandled", () => {
    it("onSecondary fires when the secondary button is clicked", () => {
      const { onSecondary } = renderSheet(makeDecision());
      fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
      expect(onSecondary).toHaveBeenCalledTimes(1);
    });

    it("clicking dismiss reveals the inline reason capture (not a direct onDismiss call)", () => {
      const { onDismiss } = renderSheet(makeDecision());
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      // The inline reason field appears
      expect(screen.getByPlaceholderText(/why|reason/i)).toBeInTheDocument();
      // onDismiss is NOT called yet
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("onDismiss fires (with undefined note) after confirming the decline with no reason", () => {
      const { onDismiss } = renderSheet(makeDecision());
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      fireEvent.click(screen.getByRole("button", { name: /confirm decline/i }));
      expect(onDismiss).toHaveBeenCalledWith(undefined);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("when alreadyHandled is set, the .ds-banner renders the label", () => {
      const { container } = renderSheet(makeDecision(), {
        alreadyHandled: { kind: "expired", label: "This approval has expired." },
      });
      expect(container.querySelector(".ds-banner")).toBeInTheDocument();
      expect(screen.getByText("This approval has expired.")).toBeInTheDocument();
    });

    it("when alreadyHandled is set, primary button is disabled", () => {
      renderSheet(makeDecision({ meta: { riskContract: lowContract } }), {
        alreadyHandled: { kind: "expired", label: "Expired" },
      });
      expect(screen.getByRole("button", { name: "Yes, send it" })).toBeDisabled();
    });

    it("when alreadyHandled is set, secondary button is disabled", () => {
      renderSheet(makeDecision(), {
        alreadyHandled: { kind: "expired", label: "Expired" },
      });
      expect(screen.getByRole("button", { name: "Not yet" })).toBeDisabled();
    });

    it("when alreadyHandled is set, dismiss button is disabled", () => {
      renderSheet(makeDecision(), {
        alreadyHandled: { kind: "expired", label: "Expired" },
      });
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
    });

    it("when alreadyHandled is set, clicking primary does NOT call onCommit", () => {
      const { onCommit } = renderSheet(makeDecision({ meta: { riskContract: lowContract } }), {
        alreadyHandled: { kind: "expired", label: "Expired" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("when alreadyHandled is null, buttons are NOT disabled", () => {
      renderSheet(makeDecision({ meta: { riskContract: lowContract } }), { alreadyHandled: null });
      expect(screen.getByRole("button", { name: "Yes, send it" })).not.toBeDisabled();
    });
  });

  // Extra: contactName and data-agent attribute
  describe("(extra) contact name and data attributes", () => {
    it("renders contactName when set", () => {
      renderSheet(makeDecision({ meta: { riskContract: lowContract, contactName: "Maya R." } }));
      expect(screen.getByText("Maya R.")).toBeInTheDocument();
    });

    it("does not render the contact strip when contactName is absent", () => {
      const { container } = renderSheet(makeDecision({ meta: { riskContract: lowContract } }));
      expect(container.querySelector(".ds-contact-strip")).not.toBeInTheDocument();
    });

    it("sets data-agent attribute to the agentKey on the root element", () => {
      renderSheet(makeDecision({ agentKey: "riley" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("data-agent", "riley");
    });
  });

  // ── Task 3: evidence block, at-stake, signals redesign ────────────────────────

  /**
   * Builder for a recommendation-type Decision with meta overrides.
   * Spreads a base fixture so individual tests only specify what they care about.
   */
  function recWith(
    overrides: {
      dataLines?: Array<string | string[]>;
      dollarsAtRisk?: number;
      confidence?: number;
    } = {},
  ): Decision {
    return makeDecision({
      meta: {
        riskContract: lowContract,
        ...(overrides.dollarsAtRisk !== undefined && { dollarsAtRisk: overrides.dollarsAtRisk }),
        ...(overrides.confidence !== undefined && { confidence: overrides.confidence }),
      },
      presentation: {
        primaryLabel: "Yes, send it",
        secondaryLabel: "Not yet",
        dismissLabel: "Dismiss",
        dataLines: overrides.dataLines ?? [],
      },
    });
  }

  const noop = {
    onClose: vi.fn(),
    onCommit: vi.fn(),
    onSecondary: vi.fn(),
    onDismiss: vi.fn(),
  };

  describe("(h) evidence section (Task 3)", () => {
    it("shows evidence dataLines in their own block and no dead placeholder", () => {
      render(
        <ApprovalDetailSheet
          decision={recWith({ dataLines: [["Impact", "+18 bookings/wk"]] })}
          {...noop}
        />,
      );
      expect(screen.getByText("Impact · +18 bookings/wk")).toBeInTheDocument();
      expect(screen.queryByText(/preview not yet wired/i)).not.toBeInTheDocument();
    });

    it("does NOT render the dead ds-pending placeholder at all", () => {
      const { container } = render(<ApprovalDetailSheet decision={recWith()} {...noop} />);
      expect(container.querySelector(".ds-pending")).not.toBeInTheDocument();
    });
  });

  describe("(i) at-stake section (Task 3)", () => {
    it("renders dollar-at-stake in S$ only when > 0", () => {
      const { rerender } = render(
        <ApprovalDetailSheet decision={recWith({ dollarsAtRisk: 450 })} {...noop} />,
      );
      expect(screen.getByText(/S\$450/)).toBeInTheDocument();
      rerender(<ApprovalDetailSheet decision={recWith({ dollarsAtRisk: 0 })} {...noop} />);
      expect(screen.queryByText(/Estimated impact/i)).not.toBeInTheDocument();
    });

    it("does NOT render at-stake section when dollarsAtRisk is absent", () => {
      render(<ApprovalDetailSheet decision={recWith()} {...noop} />);
      expect(screen.queryByText(/Estimated impact/i)).not.toBeInTheDocument();
    });
  });

  describe("(j) signals / confidence chip (Task 3)", () => {
    it("renders a banded confidence chip when present", () => {
      render(<ApprovalDetailSheet decision={recWith({ confidence: 0.9 })} {...noop} />);
      expect(screen.getByText("High confidence")).toBeInTheDocument();
    });

    it("renders 'Medium confidence' chip for confidence 0.6", () => {
      render(<ApprovalDetailSheet decision={recWith({ confidence: 0.6 })} {...noop} />);
      expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    });

    it("renders risk section heading as 'Signals' (not 'Risk')", () => {
      render(<ApprovalDetailSheet decision={recWith({ confidence: 0.9 })} {...noop} />);
      // The section eyebrow should say "Signals" now
      expect(screen.getByText("Signals")).toBeInTheDocument();
    });
  });

  // ── Task 4: reason-on-override (optional note on decline) ────────────────────

  describe("(k) decline reason capture (Task 4)", () => {
    it("clicking dismiss reveals an inline reason capture (not a direct onDismiss call)", async () => {
      const onDismiss = vi.fn();
      render(<ApprovalDetailSheet decision={recWith({})} {...noop} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByRole("button", { name: /decline|dismiss/i }));
      // reason field should now be visible
      expect(screen.getByPlaceholderText(/why|reason/i)).toBeInTheDocument();
      // onDismiss must NOT have been called yet
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("captures an optional reason on decline and forwards it to onDismiss", async () => {
      const onDismiss = vi.fn();
      render(<ApprovalDetailSheet decision={recWith({})} {...noop} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByRole("button", { name: /decline|dismiss/i }));
      await userEvent.type(screen.getByPlaceholderText(/why|reason/i), "Budget already maxed");
      await userEvent.click(screen.getByRole("button", { name: /confirm decline|decline/i }));
      expect(onDismiss).toHaveBeenCalledWith("Budget already maxed");
    });

    it("confirming with no text calls onDismiss with undefined (not empty string)", async () => {
      const onDismiss = vi.fn();
      render(<ApprovalDetailSheet decision={recWith({})} {...noop} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByRole("button", { name: /decline|dismiss/i }));
      // Leave the reason field empty
      await userEvent.click(screen.getByRole("button", { name: /confirm decline|decline/i }));
      expect(onDismiss).toHaveBeenCalledWith(undefined);
    });

    it("cancelling the decline reason returns to the main action row", async () => {
      const onDismiss = vi.fn();
      render(<ApprovalDetailSheet decision={recWith({})} {...noop} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByRole("button", { name: /decline|dismiss/i }));
      // reason field is visible
      expect(screen.getByPlaceholderText(/why|reason/i)).toBeInTheDocument();
      // cancel
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      // reason field gone, main actions back
      expect(screen.queryByPlaceholderText(/why|reason/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /decline|dismiss/i })).toBeInTheDocument();
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("declining state resets when decision changes", async () => {
      const dec1 = recWith({});
      const dec2 = { ...recWith({}), id: "dec-2" };
      const handlers = { ...noop, onDismiss: vi.fn() };
      const { rerender } = render(<ApprovalDetailSheet decision={dec1} {...handlers} />);
      await userEvent.click(screen.getByRole("button", { name: /decline|dismiss/i }));
      expect(screen.getByPlaceholderText(/why|reason/i)).toBeInTheDocument();
      // swap decision
      rerender(<ApprovalDetailSheet decision={dec2} {...handlers} />);
      expect(screen.queryByPlaceholderText(/why|reason/i)).not.toBeInTheDocument();
    });

    it("the high-risk approve ConfirmInline is unaffected by the declining flow", async () => {
      const confirmRiskContract = {
        riskLevel: "high" as const,
        externalEffect: false,
        financialEffect: false,
        clientFacing: false,
        requiresConfirmation: true,
      };
      const { onCommit } = renderSheet(
        makeDecision({ meta: { riskContract: confirmRiskContract } }),
      );
      // Primary shows "..." suffix (must confirm)
      await userEvent.click(screen.getByRole("button", { name: /yes, send it…/i }));
      // ConfirmInline for approve is showing
      expect(screen.getByText(/one last check/i)).toBeInTheDocument();
      expect(onCommit).not.toHaveBeenCalled();
    });
  });
});
