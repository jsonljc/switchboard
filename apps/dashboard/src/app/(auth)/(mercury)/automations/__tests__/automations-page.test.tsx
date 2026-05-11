import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutomationsPage } from "../automations-page";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    automations: { list: (q: object) => ["org-test", "automations", "list", q] as const },
  }),
}));

beforeEach(() => {
  // Empty string is falsy + `=== "true"` is false → useAutomationsList bails
  // to fixtures, so render path doesn't issue real HTTP through the
  // QueryClient wrapper below. (Real-QC pattern is incidental, not a tested
  // contract — see D7-3 commit notes.)
  vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function withQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("<AutomationsPage />", () => {
  it("renders fixture rows under the Active chip by default", async () => {
    render(withQuery(<AutomationsPage />));
    expect(screen.getByText("Automations")).toBeInTheDocument();
    // Default-active chip shows count from fixture (3 active rows).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Active 3/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    // Active rows from the fixture should be visible. The trigger id is
    // only shown inside the drawer, so we assert against the visible
    // scheduleLabel for each active row instead.
    const expectedActiveSchedules = AUTOMATIONS_FIXTURE_PAGE.rows
      .filter((r) => r.status === "active")
      .map((r) => r.scheduleLabel);
    for (const label of expectedActiveSchedules) {
      // Non-active rows from the fixture should still render because the
      // live-flag is off so we don't actually filter server-side; the chip
      // is purely cosmetic in fixture mode.
      expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
    }
  });

  it("renders the zero-state when fixture statusCounts.all is 0", async () => {
    // Override fixture by mocking the hook for this test.
    vi.doMock("../fixtures", () => ({
      AUTOMATIONS_FIXTURE_PAGE: {
        rows: [],
        statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 },
        nextCursor: null,
        hasMore: false,
      },
    }));
    vi.resetModules();
    const { AutomationsPage: PageLocal } = await import("../automations-page");
    render(withQuery(<PageLocal />));
    await waitFor(() => {
      expect(screen.getByText(/No automations yet/i)).toBeInTheDocument();
    });
    vi.doUnmock("../fixtures");
  });
});
