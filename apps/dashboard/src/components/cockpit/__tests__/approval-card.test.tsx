// apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard } from "../approval-card";
import type { AlexApprovalView, RileyApprovalView } from "../types";
import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view";
import {
  pauseFixture,
  scaleFixture,
  refreshCreativeFixture,
  restructureFixture,
  shiftBudgetFixture,
  switchEventFixture,
  hardenCapiFixture,
  holdFixture,
  addCreativeFixture,
  reviewBudgetFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures";

const fixture: AlexApprovalView = {
  id: "appr_1",
  kind: "pricing",
  urgency: "this_week",
  askedAt: "4 min ago",
  title: "Send Jordan the founding-member rate?",
  body: "Alex wants to offer $89/mo on a 6-month — your founding rate, normally $119.",
  quote: "I'm honestly in if the price is right.",
  quoteFrom: "Jordan F. · 11:53",
  presentation: { primaryLabel: "Accept & send", dismissLabel: "Decline" },
  primary: "Accept & send",
  secondary: "Decline",
  primaryAction: { kind: "respond", bindingHash: "hash_abc", verdict: "accept" },
};

describe("ApprovalCard", () => {
  it("renders title, body, quote, and the Alex 'needs you' eyebrow", () => {
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />);
    expect(screen.getByText(fixture.title)).toBeInTheDocument();
    expect(screen.getByText(/founding-member rate/i)).toBeInTheDocument();
    expect(screen.getByText(/Jordan F\. · 11:53/)).toBeInTheDocument();
    expect(screen.getByText(/Alex needs you/i)).toBeInTheDocument();
  });

  it("invokes onResolve('accept', 0) when primary button is clicked", () => {
    const handler = vi.fn();
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept & send" }));
    expect(handler).toHaveBeenCalledWith("accept", 0);
  });

  it("invokes onResolve('decline', 0) when secondary button is clicked", () => {
    const handler = vi.fn();
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(handler).toHaveBeenCalledWith("decline", 0);
  });

  it("shows the 'N of M' indicator when there are multiple cards", () => {
    render(<ApprovalCard data={fixture} idx={1} total={3} onResolve={() => {}} />);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("renders without a quote when one isn't provided", () => {
    const noQuote: AlexApprovalView = { ...fixture, quote: undefined, quoteFrom: undefined };
    render(<ApprovalCard data={noQuote} idx={0} total={1} onResolve={() => {}} />);
    expect(screen.queryByText(/Jordan F\./)).not.toBeInTheDocument();
  });

  it("renders the inline avatar chip with default 'A' letter and accent.soft background", () => {
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />);
    const chip = screen.getByTestId("approval-card-avatar-chip");
    expect(chip.textContent).toBe("A");
    // Accent default is ALEX_APPROVAL_ACCENT.soft — verify via inline style
    expect(chip.getAttribute("style")).toContain("rgb(241, 226, 194)"); // #F1E2C2
  });

  it("avatarLetter prop overrides the default monogram independent of senderLabel", () => {
    render(
      <ApprovalCard
        data={fixture}
        idx={0}
        total={1}
        onResolve={() => {}}
        avatarLetter="R"
        senderLabel="Needs review"
      />,
    );
    expect(screen.getByTestId("approval-card-avatar-chip").textContent).toBe("R");
  });
});

// --- B.1 Riley cross-agent contract extension ---

const RILEY_SINGLES = [
  { name: "pause", fixture: pauseFixture },
  { name: "scale", fixture: scaleFixture },
  { name: "refresh_creative", fixture: refreshCreativeFixture },
  { name: "restructure", fixture: restructureFixture },
  { name: "shift_budget_to_source", fixture: shiftBudgetFixture },
  { name: "switch_optimization_event", fixture: switchEventFixture },
  { name: "harden_capi_attribution", fixture: hardenCapiFixture },
  { name: "hold", fixture: holdFixture },
  { name: "add_creative", fixture: addCreativeFixture },
  { name: "review_budget", fixture: reviewBudgetFixture },
];

describe("ApprovalCard — Riley shape (B.1 cross-agent contract)", () => {
  it.each(RILEY_SINGLES)("renders Riley variant: $name", ({ fixture: f }) => {
    const views = mapRecommendationsToApprovalViews([f]);
    expect(views).toHaveLength(1);
    const view = views[0] as RileyApprovalView;
    render(<ApprovalCard data={view} idx={0} total={1} onResolve={vi.fn()} />);
    // primary may coincide with title for some variants — use getAllByText
    expect(screen.getAllByText(view.primary).length).toBeGreaterThan(0);
    expect(screen.getByText(view.quote as string)).toBeInTheDocument();
  });

  it("renders the grouped signal_health_group card (account-level)", () => {
    const views = mapRecommendationsToApprovalViews(signalHealthFixtures);
    expect(views).toHaveLength(1);
    const view = views[0] as RileyApprovalView;
    render(<ApprovalCard data={view} idx={0} total={1} onResolve={vi.fn()} />);
    expect(screen.getByText("Open Events Manager")).toBeInTheDocument();
    expect(screen.queryByText(/dismiss all/i)).not.toBeInTheDocument();
  });

  it("Riley external-action variants are external (review_budget, harden_capi_attribution)", () => {
    const externalVariants = [reviewBudgetFixture, hardenCapiFixture];
    for (const f of externalVariants) {
      const [view] = mapRecommendationsToApprovalViews([f]);
      expect(view.primaryAction.kind).toBe("external");
    }
  });
});

// --- B.3 accent + senderLabel prop tests ---

const rileyFixtureInline: RileyApprovalView = {
  id: "appr_riley_1",
  kind: "pause",
  urgency: "immediate",
  askedAt: "2 min ago",
  title: "Pause Summer Sale campaign?",
  body: "CPA has risen 34% over the last 12 hours.",
  quote: "Signal quality dropped below threshold.",
  quoteFrom: "Riley · ad account analysis",
  presentation: { primaryLabel: "Pause campaign", dismissLabel: "Keep running" },
  primary: "Pause campaign",
  secondary: "Keep running",
  primaryAction: {
    kind: "internal",
    intent: "riley.pause",
    parameters: { campaignId: "camp_001" },
  },
  campaign: { kind: "campaign", name: "Summer Sale", id: "camp_001" },
  confidence: 0.87,
  learningPhaseImpact: "no impact",
  reversible: true,
};

describe("ApprovalCard — B.3 accent + senderLabel props", () => {
  it("renders the default sender label and Alex accent when no overrides are passed", () => {
    const { container } = render(
      <ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />,
    );
    expect(container.textContent).toContain("Alex needs you");
  });

  it("renders custom senderLabel when supplied", () => {
    const { container } = render(
      <ApprovalCard
        data={rileyFixtureInline}
        idx={0}
        total={1}
        onResolve={() => {}}
        senderLabel="Riley needs you"
      />,
    );
    expect(container.textContent).toContain("Riley needs you");
    expect(container.textContent).not.toContain("Alex needs you");
  });

  it("renders custom accent on the eyebrow color", () => {
    const accent = { base: "#B86C50", deep: "#7E4533", soft: "#ECD4C8", paper: "#F6E7DE" };
    const { container } = render(
      <ApprovalCard
        data={rileyFixtureInline}
        idx={0}
        total={1}
        onResolve={() => {}}
        accent={accent}
        senderLabel="Riley needs you"
      />,
    );
    // The eyebrow span is the first span carrying the senderLabel text.
    const eyebrow = Array.from(container.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("Riley needs you"),
    ) as HTMLElement | undefined;
    expect(eyebrow).toBeDefined();
    expect(eyebrow!.style.color.toLowerCase()).toBe("rgb(126, 69, 51)");
  });

  it("renders Alex amber on the eyebrow when accent is not overridden", () => {
    const { container } = render(
      <ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />,
    );
    const eyebrow = Array.from(container.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("Alex needs you"),
    ) as HTMLElement | undefined;
    expect(eyebrow).toBeDefined();
    expect(eyebrow!.style.color.toLowerCase()).not.toBe("rgb(126, 69, 51)");
    expect(eyebrow!.style.color.length).toBeGreaterThan(0);
  });
});
