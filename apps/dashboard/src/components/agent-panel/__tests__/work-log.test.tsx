import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Controllable per-test state
let activityData: { rows: unknown[] } | undefined = undefined;
let activityIsLoading = false;
let activityIsError = false;

vi.mock("@/hooks/use-agent-activity-cockpit", () => ({
  useAgentActivityCockpit: () => ({
    data: activityData,
    isLoading: activityIsLoading,
    isError: activityIsError,
    error: null,
  }),
}));

// Import component after mocks
import { WorkLog } from "../work-log";
import { composeActivityVoice } from "../lib/activity-voice";
import type { ActivityRow } from "@/components/cockpit/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: "row-1",
    time: "14:32",
    kind: "replied",
    head: "about Botox pricing",
    timestampIso: "2026-05-28T12:30:00Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkLog slot", () => {
  beforeEach(() => {
    activityData = undefined;
    activityIsLoading = false;
    activityIsError = false;
  });

  // ── Loading ──────────────────────────────────────────────────────────────────

  it("loading → renders skeleton (aria-busy), not error or empty copy", () => {
    activityIsLoading = true;
    activityData = undefined;
    const { container } = render(<WorkLog agentKey="alex" />);
    // Skeleton container should have aria-busy
    const skeleton = container.querySelector("[aria-busy='true']");
    expect(skeleton).not.toBeNull();
    // Must NOT show error or empty copy during loading
    expect(screen.queryByText("Couldn't load recent work")).not.toBeInTheDocument();
    expect(screen.queryByText("No actions in the last 24 hours")).not.toBeInTheDocument();
  });

  // ── Error ─────────────────────────────────────────────────────────────────────

  it("error → 'Couldn't load recent work', never empty copy", () => {
    activityIsError = true;
    activityData = undefined;
    render(<WorkLog agentKey="alex" />);
    expect(screen.getByText("Couldn't load recent work")).toBeInTheDocument();
    expect(screen.queryByText("No actions in the last 24 hours")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("data is undefined (no error, no loading) → 'Couldn't load recent work'", () => {
    activityIsError = false;
    activityIsLoading = false;
    activityData = undefined;
    render(<WorkLog agentKey="alex" />);
    expect(screen.getByText("Couldn't load recent work")).toBeInTheDocument();
  });

  // ── Empty ─────────────────────────────────────────────────────────────────────

  it("loaded + 0 rows → 'No actions in the last 24 hours'", () => {
    activityData = { rows: [] };
    render(<WorkLog agentKey="alex" />);
    expect(screen.getByText("No actions in the last 24 hours")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load recent work")).not.toBeInTheDocument();
  });

  // ── Cap at 5 rows ─────────────────────────────────────────────────────────────

  it("renders at most 5 rows when given 7 rows", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ id: `row-${i}`, kind: "replied", head: `about topic ${i}`, who: `Contact ${i}` }),
    );
    activityData = { rows };
    const { container } = render(<WorkLog agentKey="alex" />);
    // Each row is a listitem
    const listitems = container.querySelectorAll("[role='listitem']");
    expect(listitems).toHaveLength(5);
  });

  it("renders exactly 5 rows when given exactly 5", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `row-${i}`, kind: "booked", head: `for slot ${i}`, who: `Client ${i}` }),
    );
    activityData = { rows };
    const { container } = render(<WorkLog agentKey="alex" />);
    const listitems = container.querySelectorAll("[role='listitem']");
    expect(listitems).toHaveLength(5);
  });

  it("renders all rows when fewer than 5", () => {
    const rows = [
      makeRow({ id: "row-0", kind: "replied", head: "about pricing", who: "Maya R." }),
      makeRow({ id: "row-1", kind: "booked", head: "for Thu 2pm", who: "Jen T." }),
    ];
    activityData = { rows };
    const { container } = render(<WorkLog agentKey="alex" />);
    const listitems = container.querySelectorAll("[role='listitem']");
    expect(listitems).toHaveLength(2);
  });

  // ── First-person voice ────────────────────────────────────────────────────────

  it("each row uses composeActivityVoice — 'replied' kind renders first-person sentence", () => {
    const row = makeRow({ kind: "replied", head: "about Botox pricing", who: "Maya R." });
    activityData = { rows: [row] };
    render(<WorkLog agentKey="alex" />);
    const expected = composeActivityVoice(row);
    expect(expected).toBe("I replied to Maya R. about Botox pricing");
    expect(screen.getByText("I replied to Maya R. about Botox pricing")).toBeInTheDocument();
  });

  it("each row uses composeActivityVoice — 'booked' kind renders first-person sentence", () => {
    const row = makeRow({ kind: "booked", head: "for Thu 2pm", who: "Jen T." });
    activityData = { rows: [row] };
    render(<WorkLog agentKey="alex" />);
    const expected = composeActivityVoice(row);
    expect(expected).toBe("I booked Jen T.'s consult for Thu 2pm");
    expect(screen.getByText("I booked Jen T.'s consult for Thu 2pm")).toBeInTheDocument();
  });

  it("each row uses composeActivityVoice — 'escalated' kind renders first-person sentence", () => {
    const row = makeRow({
      kind: "escalated",
      head: "Botox query → your inbox",
      who: "Sam K.",
    });
    activityData = { rows: [row] };
    render(<WorkLog agentKey="alex" />);
    const expected = composeActivityVoice(row);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders first-person voice for multiple rows", () => {
    const rows = [
      makeRow({ id: "r1", kind: "replied", head: "about pricing", who: "Maya R." }),
      makeRow({ id: "r2", kind: "booked", head: "for Mon 10am", who: "Jen T." }),
      makeRow({ id: "r3", kind: "qualified", head: "Lead interested in filler" }),
    ];
    activityData = { rows };
    render(<WorkLog agentKey="alex" />);
    expect(screen.getByText(composeActivityVoice(rows[0]))).toBeInTheDocument();
    expect(screen.getByText(composeActivityVoice(rows[1]))).toBeInTheDocument();
    expect(screen.getByText(composeActivityVoice(rows[2]))).toBeInTheDocument();
  });

  // ── Header ────────────────────────────────────────────────────────────────────

  it("header uses honest count-based framing (singular)", () => {
    const rows = [makeRow({ id: "r0", kind: "sent", head: "batch" })];
    activityData = { rows };
    render(<WorkLog agentKey="alex" />);
    // 1 thing → singular
    expect(screen.getByText("Alex handled 1 thing recently")).toBeInTheDocument();
  });

  it("header uses honest count-based framing (plural)", () => {
    const rows = [
      makeRow({ id: "r0", kind: "replied", head: "pricing", who: "A" }),
      makeRow({ id: "r1", kind: "booked", head: "slot", who: "B" }),
      makeRow({ id: "r2", kind: "qualified", head: "lead" }),
    ];
    activityData = { rows };
    render(<WorkLog agentKey="alex" />);
    expect(screen.getByText("Alex handled 3 things recently")).toBeInTheDocument();
  });

  it("header reflects the capped count (5 rows) even when 7 given", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ id: `r${i}`, kind: "replied", head: `topic ${i}`, who: `C ${i}` }),
    );
    activityData = { rows };
    render(<WorkLog agentKey="alex" />);
    // Only 5 shown → header reflects 5
    expect(screen.getByText("Alex handled 5 things recently")).toBeInTheDocument();
  });

  it("header uses agent name — Riley shows Riley's name", () => {
    const rows = [makeRow({ id: "r0", kind: "scaled", head: "the campaign" })];
    activityData = { rows };
    render(<WorkLog agentKey="riley" />);
    expect(screen.getByText("Riley handled 1 thing recently")).toBeInTheDocument();
  });

  // ── "See all in Results →" footer ────────────────────────────────────────────

  it("footer 'See all in Results →' is present when there are rows", () => {
    const rows = [makeRow({ id: "r0", kind: "replied", head: "about pricing", who: "Maya" })];
    activityData = { rows };
    render(<WorkLog agentKey="alex" />);
    expect(screen.getByText("See all in Results →")).toBeInTheDocument();
  });

  it("footer calls onSeeAll when clicked", () => {
    const rows = [makeRow({ id: "r0", kind: "replied", head: "about pricing", who: "Maya" })];
    activityData = { rows };
    const onSeeAll = vi.fn();
    render(<WorkLog agentKey="alex" onSeeAll={onSeeAll} />);
    fireEvent.click(screen.getByText("See all in Results →"));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("footer 'See all in Results →' is a native <button>", () => {
    const rows = [makeRow({ id: "r0", kind: "replied", head: "about pricing", who: "Maya" })];
    activityData = { rows };
    render(<WorkLog agentKey="alex" />);
    const btn = screen.getByText("See all in Results →").closest("button");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("type")).toBe("button");
  });

  it("footer is NOT present on error state", () => {
    activityIsError = true;
    render(<WorkLog agentKey="alex" />);
    expect(screen.queryByText("See all in Results →")).not.toBeInTheDocument();
  });

  it("footer is NOT present on empty state", () => {
    activityData = { rows: [] };
    render(<WorkLog agentKey="alex" />);
    expect(screen.queryByText("See all in Results →")).not.toBeInTheDocument();
  });

  // ── ActivityRow.head is pre-formatted text — NO ÷100 ─────────────────────────
  // The backend translator (cockpit-activity-translator.ts) always renders head
  // as prose strings (e.g. "Maya R. · Botox pricing", "Booking confirmed").
  // Raw numeric cents are never placed in head/body. Rendering verbatim is correct.

  it("head is rendered verbatim — no ÷100 applied to a pre-formatted string", () => {
    // Simulate a budget figure that LOOKS like cents but is already formatted prose
    const row = makeRow({
      kind: "scaled",
      head: "budget to $1,420/day",
    });
    activityData = { rows: [row] };
    render(<WorkLog agentKey="riley" />);
    // composeActivityVoice("scaled") → "I scaled {head}"
    expect(screen.getByText("I scaled budget to $1,420/day")).toBeInTheDocument();
    // Must NOT attempt to parse the string as a number and divide it
    expect(screen.queryByText(/I scaled \$14/)).not.toBeInTheDocument();
  });
});
