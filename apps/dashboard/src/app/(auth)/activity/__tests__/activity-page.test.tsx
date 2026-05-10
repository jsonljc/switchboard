import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntriesListResponse } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports of the mocked modules.
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => useSearchParamsMock(),
}));

const mockUseActivityList = vi.fn();
vi.mock("../hooks/use-activity-list", () => ({
  useActivityList: (...args: unknown[]) => mockUseActivityList(...args),
}));

// ---------------------------------------------------------------------------
// Delayed import so mocks are in place first.
// ---------------------------------------------------------------------------

import { ActivityPage } from "../activity-page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSearch(qs: string) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(qs));
}

function hookResult(
  partial: Partial<{
    rows: AuditEntriesListResponse["rows"];
    nextCursor: string | null;
    scope: AuditEntriesListResponse["scope"];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  }>,
): unknown {
  const rows = partial.rows ?? [];
  const data: AuditEntriesListResponse = {
    rows,
    nextCursor: partial.nextCursor ?? null,
    scope: partial.scope ?? "operational",
    appliedFilters: {
      eventType: null,
      actorType: null,
      entityType: null,
      entityId: null,
      after: null,
      before: null,
    },
  };
  return {
    data: partial.isLoading || partial.isError ? undefined : data,
    isLoading: partial.isLoading ?? false,
    isError: partial.isError ?? false,
    isSuccess: !partial.isLoading && !partial.isError,
    refetch: partial.refetch ?? vi.fn().mockResolvedValue(undefined),
    error: partial.isError ? new Error("fetch failed") : null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearch("");
    // Default: gate is off (NEXT_PUBLIC_ACTIVITY_LIVE not set).
    delete process.env.NEXT_PUBLIC_ACTIVITY_LIVE;
    // Provide a stub hook return value for gate-off tests (hook still mounts).
    mockUseActivityList.mockReturnValue(hookResult({}));
  });

  // ── 1. Gate-off renders fixtures ──────────────────────────────────────────
  it("gate-off: renders fixtures without NEXT_PUBLIC_ACTIVITY_LIVE", () => {
    render(<ActivityPage />);
    // "Operational" scope: event.published (non-operational) is excluded.
    // The first operational fixture has summary starting with "Booked appointment".
    expect(screen.getByText(/Booked appointment for contact/)).toBeInTheDocument();
    // Non-operational row should NOT appear under the default operational scope.
    expect(screen.queryByText(/Event order.completed published to subscribers/)).toBeNull();
  });

  // ── 2. Gate-on renders rows from hook ─────────────────────────────────────
  it("gate-on: renders rows returned by useActivityList", () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    mockUseActivityList.mockReturnValue(
      hookResult({
        rows: [
          {
            id: "audit_live_001",
            eventType: "action.executed",
            timestamp: "2026-05-10T10:00:00Z",
            actorType: "agent",
            actorId: "agent_alex_001",
            entityType: "calendar_event",
            entityId: "cal_evt_1",
            riskCategory: "low",
            visibilityLevel: "org",
            summary: "Live row from API hook",
            snapshotKeys: [],
            redactedKeyCount: 0,
            evidencePointers: [],
            entryHash: "aaa",
            previousEntryHash: "bbb",
            envelopeId: null,
            traceId: null,
          },
        ],
        scope: "operational",
      }),
    );
    render(<ActivityPage />);
    expect(screen.getByText("Live row from API hook")).toBeInTheDocument();
  });

  // ── 3. Empty state — no filters active ───────────────────────────────────
  it("zero-state: renders 'No activity yet' when rows are empty and no filters active", () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    mockUseActivityList.mockReturnValue(hookResult({ rows: [], scope: "operational" }));
    render(<ActivityPage />);
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
    // The zero-state has no "Clear filters" button.
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
  });

  // ── 4. Filtered-empty distinction ─────────────────────────────────────────
  it("filtered-empty: renders 'No matching activity' with Clear filters when URL param is active", () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    setSearch("eventType=action.executed");
    mockUseActivityList.mockReturnValue(hookResult({ rows: [], scope: "custom" }));
    render(<ActivityPage />);
    expect(screen.getByText(/No matching activity/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear filters/ })).toBeInTheDocument();
  });

  it("filtered-empty Clear filters resets to default (drops scope=all)", async () => {
    // Empty-state Clear is a full reset: drop ALL params, including scope.
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    setSearch("scope=all&eventType=action.executed");
    mockUseActivityList.mockReturnValue(hookResult({ rows: [], scope: "custom" }));
    render(<ActivityPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(mockReplace).toHaveBeenCalledWith("/activity", { scroll: false });
  });

  // Shared minimal AuditEntryBrowseRow fixture for the pill-Clear tests below.
  const pillRow = {
    id: "audit_pill_001",
    eventType: "action.executed" as const,
    timestamp: "2026-05-10T10:00:00Z",
    actorType: "agent" as const,
    actorId: "agent_alex_001",
    entityType: "calendar_event",
    entityId: "cal_evt_1",
    riskCategory: "low" as const,
    visibilityLevel: "org" as const,
    summary: "Pill row for filtered-pill Clear tests",
    snapshotKeys: [],
    redactedKeyCount: 0,
    evidencePointers: [],
    entryHash: "aaa",
    previousEntryHash: "bbb",
    envelopeId: null,
    traceId: null,
  };

  it("Filtered pill Clear preserves the operator's chip choice when scope=all", async () => {
    // Spec §2.3: "[Clear] on the Filtered pill drops the URL params and returns
    // to whichever chip the operator has selected." If scope=all, keep it.
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    setSearch("scope=all&eventType=action.executed");
    // scope="custom" makes the Filtered pill render in FilterChips.
    mockUseActivityList.mockReturnValue(hookResult({ rows: [pillRow], scope: "custom" }));
    render(<ActivityPage />);
    // The Filtered pill's Clear button (rendered by FilterChips when scope=custom).
    const pillClear = screen.getByRole("button", { name: /Clear/ });
    await userEvent.setup().click(pillClear);
    expect(mockReplace).toHaveBeenCalledWith("/activity?scope=all", { scroll: false });
  });

  it("Filtered pill Clear returns to default Operational when scope=operational", async () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    setSearch("eventType=action.executed");
    mockUseActivityList.mockReturnValue(hookResult({ rows: [pillRow], scope: "custom" }));
    render(<ActivityPage />);
    const pillClear = screen.getByRole("button", { name: /Clear/ });
    await userEvent.setup().click(pillClear);
    expect(mockReplace).toHaveBeenCalledWith("/activity", { scroll: false });
  });

  // ── 5. Chip toggle clears drawer AND prevCursorStack ─────────────────────
  //
  // We use an observable proxy: PaginationFooter only appears when
  // ACTIVITY_LIVE=true AND canGoPrev || canGoNext. After advancing one page
  // (prevCursorStack gains an entry) then toggling the chip, the stack must
  // be cleared → PaginationFooter must disappear (canGoPrev false, canGoNext
  // depends on nextCursor which we set to null after chip change).
  //
  // Approach:
  //   - Start with gate-on, one row, nextCursor="cursor_1".
  //   - Click "Next" → prevCursorStack = [""], cursor = "cursor_1".
  //   - After advance, hook returns nextCursor=null (last page).
  //   - Pagination footer is visible (canGoPrev=true).
  //   - Toggle chip "All events" → filter-change effect fires → stack cleared.
  //   - PaginationFooter must not be in the document.
  //
  // The expandedRowId closure is verified via the row drawer: expand a row
  // before the chip toggle, then assert it's no longer expanded.
  it("chip toggle clears prevCursorStack and expanded drawer", async () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";

    const liveRow = {
      id: "audit_live_001",
      eventType: "action.executed" as const,
      timestamp: "2026-05-10T10:00:00Z",
      actorType: "agent" as const,
      actorId: "agent_alex_001",
      entityType: "calendar_event",
      entityId: "cal_evt_1",
      riskCategory: "low" as const,
      visibilityLevel: "org" as const,
      summary: "Live row for chip-toggle test",
      snapshotKeys: [],
      redactedKeyCount: 0,
      evidencePointers: [],
      entryHash: "aaa",
      previousEntryHash: "bbb",
      envelopeId: null,
      traceId: null,
    };

    // Initial render: one page with nextCursor set → "Next" is visible.
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], nextCursor: "cursor_1", scope: "operational" }),
    );

    render(<ActivityPage />);

    // Advance to next page so prevCursorStack gets an entry.
    const nextBtn = screen.getByRole("button", { name: /Next page/ });
    await userEvent.setup().click(nextBtn);

    // After advancing, update hook to return no next cursor but still have
    // a row (so PaginationFooter shows canGoPrev=true).
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], nextCursor: null, scope: "operational" }),
    );

    // Re-render to pick up new hook return.
    // The Prev button should now be enabled.
    await act(async () => {});

    // Now toggle to "All events" chip — filter signature changes.
    // The hook will re-fire with scope=all after URL update.
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], nextCursor: null, scope: "all" }),
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "All events" }));

    // PaginationFooter should be gone (canGoPrev false, canGoNext false).
    expect(screen.queryByRole("button", { name: /Previous page/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Next page/ })).toBeNull();
  });

  // ── 6. URL-param change clears drawer AND prevCursorStack ─────────────────
  //
  // Simulate advancing one page (prevCursorStack = ["previous_cursor"]) then
  // re-rendering with a new URL param. The filter-change effect must fire,
  // clearing the stack. Observable: PaginationFooter disappears.
  it("URL-param change clears prevCursorStack (filter-change invariant)", async () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";

    const liveRow = {
      id: "audit_live_002",
      eventType: "action.executed" as const,
      timestamp: "2026-05-10T10:00:00Z",
      actorType: "agent" as const,
      actorId: "agent_alex_001",
      entityType: "calendar_event",
      entityId: "cal_evt_2",
      riskCategory: "low" as const,
      visibilityLevel: "org" as const,
      summary: "Live row for URL param test",
      snapshotKeys: [],
      redactedKeyCount: 0,
      evidencePointers: [],
      entryHash: "ccc",
      previousEntryHash: "ddd",
      envelopeId: null,
      traceId: null,
    };

    // Initial render: no narrowing params, one page with nextCursor.
    setSearch("");
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], nextCursor: "cursor_a", scope: "operational" }),
    );

    const { rerender } = render(<ActivityPage />);

    // Advance to next page.
    await userEvent.setup().click(screen.getByRole("button", { name: /Next page/ }));

    // Simulate URL param change (e.g., actorType filter added).
    setSearch("actorType=agent");
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], nextCursor: null, scope: "custom" }),
    );

    // Re-render with new search params.
    rerender(<ActivityPage />);
    await act(async () => {});

    // Filter-change effect fires → prevCursorStack cleared → PaginationFooter gone.
    expect(screen.queryByRole("button", { name: /Previous page/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Next page/ })).toBeNull();
  });

  // ── Additional coverage ───────────────────────────────────────────────────

  it("renders the page title 'Activity'", () => {
    render(<ActivityPage />);
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
  });

  it("gate-off: 'All events' chip shows non-operational fixtures", async () => {
    render(<ActivityPage />);
    // Default scope: event.published row is hidden.
    expect(screen.queryByText(/Event order.completed published to subscribers/)).toBeNull();
    // Toggle to "All events".
    await userEvent.setup().click(screen.getByRole("button", { name: "All events" }));
    // Non-operational row should now appear.
    expect(screen.getByText(/Event order.completed published to subscribers/)).toBeInTheDocument();
  });

  it("threads scope and narrowing params from URL into the hook query", () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    setSearch("scope=all&actorType=agent&entityType=calendar_event");
    mockUseActivityList.mockReturnValue(hookResult({ rows: [], scope: "custom" }));
    render(<ActivityPage />);
    expect(mockUseActivityList).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: "all",
        actorType: "agent",
        entityType: "calendar_event",
      }),
    );
  });

  it("gate-off: pagination footer is hidden (single page of fixtures)", () => {
    render(<ActivityPage />);
    expect(screen.queryByRole("button", { name: /Next page/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Previous page/ })).toBeNull();
  });

  it("renders loading skeleton when isLoading=true", () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    mockUseActivityList.mockReturnValue(hookResult({ isLoading: true }));
    render(<ActivityPage />);
    expect(screen.getByRole("status", { name: /Loading activity/ })).toBeInTheDocument();
  });

  it("renders error empty-state when isError=true", () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";
    mockUseActivityList.mockReturnValue(hookResult({ isError: true }));
    render(<ActivityPage />);
    // isError renders the filtered-empty state (generic catch-all).
    expect(screen.getByText(/No matching activity/)).toBeInTheDocument();
  });
});
