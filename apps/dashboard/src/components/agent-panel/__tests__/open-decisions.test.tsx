import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Controllable per-test state
let feedData:
  | { decisions: unknown[]; counts: { total: number; approval: number; handoff: number } }
  | undefined = undefined;
let feedIsLoading = false;
let feedIsError = false;
// Real error object surfaced when isError is true — <QueryStates> derives state
// from {data, error}, so the error branch only fires when error != null.
let feedError: unknown = null;

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: feedData,
    isLoading: feedIsLoading,
    isError: feedIsError,
    error: feedError,
  }),
}));

// Import component after mocks
import { OpenDecisions } from "../open-decisions";
import type { Decision } from "@/lib/decisions/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Approve ad spend increase to $500/day",
    presentation: {
      primaryLabel: "Approve",
      secondaryLabel: "Reject",
      dismissLabel: "Skip",
      dataLines: [],
    },
    urgencyScore: 0.8,
    createdAt: "2026-05-26T10:00:00Z",
    threadHref: null,
    sourceRef: { kind: "approval", sourceId: "src-1" },
    meta: {},
    ...overrides,
  };
}

function makeFeed(
  decisions: Decision[],
  counts?: { total: number; approval: number; handoff: number },
) {
  const c = counts ?? { total: decisions.length, approval: decisions.length, handoff: 0 };
  return { decisions, counts: c };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OpenDecisions slot", () => {
  beforeEach(() => {
    feedData = undefined;
    feedIsLoading = false;
    feedIsError = false;
    feedError = null;
  });

  // ── Loading ──────────────────────────────────────────────────────────────────

  it("loading → renders skeleton (aria-busy), not error or empty copy", () => {
    feedIsLoading = true;
    feedData = undefined;
    const { container } = render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    // Skeleton container should have aria-busy
    const skeleton = container.querySelector("[aria-busy='true']");
    expect(skeleton).not.toBeNull();
    // Must NOT show error or empty copy during loading
    expect(screen.queryByText("Couldn't load decisions")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing waiting on you from/i)).not.toBeInTheDocument();
  });

  // ── Error ─────────────────────────────────────────────────────────────────────

  it("error → 'Couldn't load decisions', never 'Nothing waiting' or '0'", () => {
    feedIsError = true;
    feedError = new Error("boom");
    feedData = undefined;
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    expect(screen.getByText("Couldn't load decisions")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing waiting on you from/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  // Keys-pending: the hook is `enabled: !!keys`, so before the session resolves
  // orgId React Query reports isLoading:false, data:undefined, error:null. The
  // <QueryStates> {data, error} rule must treat this as LOADING (skeleton), never
  // a false error/empty flash.
  it("keys-pending (data undefined, error null, isLoading false) → loading skeleton, not error or empty", () => {
    feedIsError = false;
    feedIsLoading = false;
    feedError = null;
    feedData = undefined;
    const { container } = render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    expect(container.querySelector("[data-kind='loading']")).not.toBeNull();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText("Couldn't load decisions")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing waiting on you from/i)).not.toBeInTheDocument();
  });

  // ── Empty ─────────────────────────────────────────────────────────────────────

  it("loaded + empty decisions → 'Nothing waiting on you from Alex'", () => {
    feedData = makeFeed([]);
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    expect(screen.getByText("Nothing waiting on you from Alex")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load decisions")).not.toBeInTheDocument();
  });

  it("empty for riley → includes Riley's name", () => {
    feedData = makeFeed([]);
    render(<OpenDecisions agentKey="riley" onOpenDecision={vi.fn()} />);
    expect(screen.getByText("Nothing waiting on you from Riley")).toBeInTheDocument();
  });

  // ── Has decisions ─────────────────────────────────────────────────────────────

  it("renders count from counts.total as section meta", () => {
    const d1 = makeDecision({ id: "dec-1", humanSummary: "First decision" });
    const d2 = makeDecision({ id: "dec-2", humanSummary: "Second decision" });
    feedData = makeFeed([d1, d2], { total: 2, approval: 2, handoff: 0 });
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    // The count "2" should appear in the section meta
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders gist from humanSummary", () => {
    const dec = makeDecision({ humanSummary: "Approve ad spend increase to $500/day" });
    feedData = makeFeed([dec]);
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    expect(screen.getByText("Approve ad spend increase to $500/day")).toBeInTheDocument();
  });

  it("prepends contactName when not already in humanSummary", () => {
    const dec = makeDecision({
      humanSummary: "Approve appointment for next Thursday",
      meta: { contactName: "Maya R." },
    });
    feedData = makeFeed([dec]);
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    // contactName is not in the summary → prepend
    expect(screen.getByText("Maya R. · Approve appointment for next Thursday")).toBeInTheDocument();
  });

  it("does NOT double-prepend contactName when already in humanSummary", () => {
    const dec = makeDecision({
      humanSummary: "Reply to Maya R. about Botox pricing",
      meta: { contactName: "Maya R." },
    });
    feedData = makeFeed([dec]);
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    // contactName already in summary → render verbatim without duplication
    expect(screen.getByText("Reply to Maya R. about Botox pricing")).toBeInTheDocument();
    expect(screen.queryByText(/Maya R\. — Reply to Maya R\./)).not.toBeInTheDocument();
  });

  it("row click calls onOpenDecision with the correct decision (verified by id)", () => {
    const dec = makeDecision({ id: "dec-42", humanSummary: "Approve campaign budget" });
    feedData = makeFeed([dec]);
    const onOpen = vi.fn();
    render(<OpenDecisions agentKey="alex" onOpenDecision={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve campaign budget/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "dec-42" }));
  });

  it("row click passes the full decision object including sourceRef", () => {
    const dec = makeDecision({
      id: "dec-7",
      sourceRef: { kind: "handoff", sourceId: "src-handoff-7" },
      humanSummary: "Handle urgent escalation",
    });
    feedData = makeFeed([dec]);
    const onOpen = vi.fn();
    render(<OpenDecisions agentKey="alex" onOpenDecision={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Handle urgent escalation/i }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: { kind: "handoff", sourceId: "src-handoff-7" } }),
    );
  });

  it("each decision row is a native <button> with a visible gist", () => {
    const dec1 = makeDecision({ id: "d1", humanSummary: "First decision gist" });
    const dec2 = makeDecision({ id: "d2", humanSummary: "Second decision gist" });
    feedData = makeFeed([dec1, dec2]);
    const { container } = render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    const buttons = container.querySelectorAll("button[type='button']");
    expect(buttons).toHaveLength(2);
  });

  // ── Count equivalence ─────────────────────────────────────────────────────────
  // The count rendered must equal counts.total from the same server-filtered source
  // the Inbox uses — no client-side "open" predicate, just the hook's authoritative count.

  it("count equivalence: rendered count === fixture counts.total (not decisions.length if they differ)", () => {
    // Server may include decisions outside the rendered slice due to pagination etc.,
    // but counts.total is always the authoritative server count.
    const d1 = makeDecision({ id: "d1", humanSummary: "First" });
    const d2 = makeDecision({ id: "d2", humanSummary: "Second" });
    // counts.total from server is 5 even though we only received 2 decisions
    // (simulates server-side pagination). The rendered count should match counts.total.
    feedData = makeFeed([d1, d2], { total: 5, approval: 3, handoff: 2 });
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    // The meta text shows "5" (from counts.total), NOT "2" (from decisions.length)
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("count equivalence: N decisions for alex → rendered count equals counts.total (basic case)", () => {
    const decisions = [
      makeDecision({ id: "d1", humanSummary: "Decision one" }),
      makeDecision({ id: "d2", humanSummary: "Decision two" }),
    ];
    feedData = makeFeed(decisions, { total: 2, approval: 1, handoff: 1 });
    render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
    // counts.total === 2; the rendered meta should show "2"
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
