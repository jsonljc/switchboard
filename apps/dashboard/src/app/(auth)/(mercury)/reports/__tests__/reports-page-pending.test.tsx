import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Live mode, but the session/org keys are not resolved yet (useScopedQueryKeys
// returns null). This is the REAL React Query `enabled: false` pending state —
// data undefined, error null, isLoading false — that previously fell through to
// a blank body (#472 regression). This test uses the REAL useReportData hook
// (only its dependencies are mocked) to exercise that path end-to-end.
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => true,
  isAgentHomeLinkLive: () => false,
}));
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

import { ReportsPage } from "../reports-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

describe("ReportsPage (live mode, session keys not yet resolved, #472)", () => {
  it("renders the skeleton — never a blank body — while keys are null", () => {
    renderPage();
    expect(screen.getByLabelText(/loading report/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
