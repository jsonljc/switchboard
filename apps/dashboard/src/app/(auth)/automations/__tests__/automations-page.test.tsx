import { describe, it, expect, vi, beforeEach } from "vitest";
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
  process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "false";
});

function withQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("<AutomationsPage />", () => {
  it("renders fixture rows under the Active chip by default", async () => {
    render(withQuery(<AutomationsPage />));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Active 3/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Active 3/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Fixture mode renders all 6 rows regardless of chip (chip is cosmetic
    // until live mode applies server-side filtering). Verify each row's
    // distinctive schedule label is in the rendered table.
    for (const row of AUTOMATIONS_FIXTURE_PAGE.rows) {
      expect(screen.getByText(row.scheduleLabel, { exact: false })).toBeInTheDocument();
    }
  });

  it("renders the zero-state when fixture statusCounts.all is 0", async () => {
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
