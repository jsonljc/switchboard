import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NeedsYouBlock } from "../needs-you-block";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1" },
    status: "authenticated",
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("NeedsYouBlock", () => {
  it("renders empty-state when there are no decisions", () => {
    render(<NeedsYouBlock agentKey="alex" />, { wrapper });
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it("renders the Needs you folio header", () => {
    render(<NeedsYouBlock agentKey="alex" />, { wrapper });
    expect(screen.getByText("Needs you")).toBeInTheDocument();
  });
});
