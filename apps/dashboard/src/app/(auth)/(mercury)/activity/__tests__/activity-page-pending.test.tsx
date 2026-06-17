/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports of the mocked modules.
// ---------------------------------------------------------------------------

const useSearchParamsMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => useSearchParamsMock(),
}));

const mockUseActivityList = vi.fn();
vi.mock("../hooks/use-activity-list", () => ({
  useActivityList: (...args: unknown[]) => mockUseActivityList(...args),
}));

import { ActivityPage } from "../activity-page";

describe("ActivityPage (live mode, session keys not yet resolved)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders a loading skeleton — never the zero empty state — while keys are null", () => {
    // The REAL React Query `enabled: false` pending state: data undefined,
    // isLoading false, isError false. Previously this fell through to the
    // `zero` EmptyState (a dishonest "ledger is empty" while the query had not
    // run). See MEMORY feedback_react_query_enabled_false_isloading.
    mockUseActivityList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isSuccess: false,
      isFetching: false,
      dataUpdatedAt: 0,
      refetch: vi.fn().mockResolvedValue(undefined),
      error: null,
    });
    render(<ActivityPage />);
    expect(screen.getByRole("status", { name: /loading activity/i })).toBeInTheDocument();
    // The "zero" EmptyState (eyebrow "ledger health") must NOT appear while
    // we are pending.
    expect(screen.queryByText(/ledger health/i)).toBeNull();
  });
});
