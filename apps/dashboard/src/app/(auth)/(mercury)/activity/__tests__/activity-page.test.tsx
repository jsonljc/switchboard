import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntriesListResponse } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports of the mocked modules.
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

// Delayed import so mocks are in place first.
import { ActivityPage } from "../activity-page";

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
    dataUpdatedAt: number;
    isFetching: boolean;
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
    isFetching: partial.isFetching ?? false,
    dataUpdatedAt: partial.dataUpdatedAt ?? (partial.isError ? 0 : Date.now()),
    refetch: partial.refetch ?? vi.fn().mockResolvedValue(undefined),
    error: partial.isError ? new Error("fetch failed") : null,
  };
}

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
  summary: "Live row for tests",
  snapshotKeys: [],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "aaa",
  previousEntryHash: "bbb",
  envelopeId: null,
  traceId: null,
};

describe("ActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearch("");
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "");
    mockUseActivityList.mockReturnValue(hookResult({}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the FilterStrip — scope segment + actor pills helper line", () => {
    render(<ActivityPage />);
    expect(screen.getByRole("button", { name: /Operational/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument();
    expect(
      screen.getByText(/Specific actor filtering \(e\.g\. just Alex\) is not yet available/),
    ).toBeInTheDocument();
  });

  it("gate-off: renders fixtures under Operational by default", () => {
    render(<ActivityPage />);
    expect(screen.getByText(/Booked HydraFacial consult for contact/)).toBeInTheDocument();
    expect(screen.queryByText(/Event order\.completed published to 4 subscribers/)).toBeNull();
  });

  it("gate-on: renders rows returned by useActivityList", () => {
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    mockUseActivityList.mockReturnValue(hookResult({ rows: [liveRow], scope: "operational" }));
    render(<ActivityPage />);
    expect(screen.getByText("Live row for tests")).toBeInTheDocument();
  });

  it("reads scope=all from the URL on mount", () => {
    setSearch("scope=all");
    render(<ActivityPage />);
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("reads narrowing params from the URL on mount and shows the Custom badge", () => {
    setSearch("eventType=action.failed&actorType=user");
    render(<ActivityPage />);
    expect(screen.getByText(/Custom/)).toBeInTheDocument();
    const strip = screen.getByRole("search");
    expect(within(strip).getByRole("button", { name: /Clear filters/ })).toBeInTheDocument();
  });

  it("ignores an unknown event-type URL param (defense against deep-link garbage)", () => {
    setSearch("eventType=action.not_a_real_event");
    render(<ActivityPage />);
    // The garbage param doesn't trigger Custom mode — no narrowing should be applied.
    expect(screen.queryByText(/^· Custom$/)).toBeNull();
    const strip = screen.getByRole("search");
    expect(within(strip).queryByRole("button", { name: /Clear filters/ })).toBeNull();
  });

  it("H6: hides the `last ledger entry` tile when narrowing is active", () => {
    setSearch("eventType=action.failed");
    render(<ActivityPage />);
    expect(screen.queryByText(/last ledger entry/i)).toBeNull();
  });

  it("H6: shows the tile under default operational scope (no narrowing)", () => {
    render(<ActivityPage />);
    expect(screen.getByText(/last ledger entry/i)).toBeInTheDocument();
  });

  it("Clear filters pill preserves the operator's base scope (operational)", async () => {
    setSearch("eventType=action.failed");
    render(<ActivityPage />);
    const strip = screen.getByRole("search");
    await userEvent.setup().click(within(strip).getByRole("button", { name: /Clear filters/ }));
    expect(within(strip).queryByRole("button", { name: /Clear filters/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Clear filters pill preserves the operator's base scope (all)", async () => {
    setSearch("scope=all&eventType=action.failed");
    render(<ActivityPage />);
    const strip = screen.getByRole("search");
    await userEvent.setup().click(within(strip).getByRole("button", { name: /Clear filters/ }));
    expect(within(strip).queryByRole("button", { name: /Clear filters/ })).toBeNull();
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("changing scope via segment clears any expanded drawer state", async () => {
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    mockUseActivityList.mockReturnValue(hookResult({ rows: [liveRow], scope: "operational" }));
    render(<ActivityPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Toggle details for entry/ }));
    expect(screen.getByRole("button", { name: /Toggle details for entry/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(screen.getByRole("button", { name: /All/ }));
    expect(screen.getByRole("button", { name: /Toggle details for entry/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("does NOT write the URL when the operator changes the scope", async () => {
    render(<ActivityPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /All/ }));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("syncs back from URL on back/forward navigation (useSearchParams change)", () => {
    setSearch("scope=operational");
    const { rerender } = render(<ActivityPage />);
    expect(screen.getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    setSearch("scope=all");
    rerender(<ActivityPage />);
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
  });

  describe("H5: fetch errors never unmount the table", () => {
    it("renders the ErrorBanner above the table when isError fires after a successful fetch", () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      mockUseActivityList.mockReturnValue(hookResult({ rows: [liveRow], scope: "operational" }));
      const { rerender } = render(<ActivityPage />);
      expect(screen.getByText("Live row for tests")).toBeInTheDocument();

      mockUseActivityList.mockReturnValue(hookResult({ isError: true, rows: [] }));
      rerender(<ActivityPage />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/request failed/i)).toBeInTheDocument();
      expect(screen.getByText("Live row for tests")).toBeInTheDocument();
    });

    it("retry button on the banner fires the refetch handler", async () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      const refetch = vi.fn().mockResolvedValue(undefined);
      mockUseActivityList.mockReturnValue(hookResult({ rows: [liveRow], scope: "operational" }));
      const { rerender } = render(<ActivityPage />);
      mockUseActivityList.mockReturnValue(hookResult({ isError: true, refetch }));
      rerender(<ActivityPage />);
      await userEvent.setup().click(screen.getByRole("button", { name: /Retry/ }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Stale pill visibility", () => {
    it("is hidden until the first successful fetch (dataUpdatedAt === 0)", () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      mockUseActivityList.mockReturnValue(hookResult({ isLoading: true, dataUpdatedAt: 0 }));
      render(<ActivityPage />);
      // The skeleton block also carries role="status"; assert specifically on
      // the StalePill copy ("fetched") instead.
      expect(screen.queryByText(/^fetched$/)).toBeNull();
    });

    it("renders after a successful fetch (dataUpdatedAt > 0)", () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      mockUseActivityList.mockReturnValue(
        hookResult({ rows: [liveRow], scope: "operational", dataUpdatedAt: Date.now() }),
      );
      render(<ActivityPage />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText(/fetched/)).toBeInTheDocument();
    });
  });
});
