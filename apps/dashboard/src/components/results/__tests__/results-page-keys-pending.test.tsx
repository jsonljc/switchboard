import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Live mode so the report hook is the live path (no fixture fallback). The hook
// is mocked below to the keys-pending shape, so the value here only affects the
// no-Meta banner gate — connections are absent, but we assert on the body only.
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => true }));
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: () => null }));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/agent-panel/agent-panel", () => ({
  AgentPanel: () => null,
}));

// Keys-pending: a disabled (enabled:false) query is pending+idle, so React
// Query reports isLoading:false, data:undefined, error:null. The old gate read
// `if (isLoading)` and fell through to <FirstRunNote/>; QueryStates derives
// "loading" from {data, error} and must render the skeleton instead.
const refreshMock = vi.fn();
vi.mock("@/app/(auth)/(mercury)/reports/hooks/use-report-data", () => ({
  useReportData: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refresh: refreshMock,
    retry: vi.fn(),
  }),
}));

import { ResultsPage } from "../results-page";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ResultsPage />
    </QueryClientProvider>,
  );
}

describe("ResultsPage — live keys-pending window", () => {
  it("renders the skeleton, not the first-run note, while keys are pending", () => {
    mount();
    expect(screen.getByLabelText(/loading results/i)).toBeInTheDocument();
    // FirstRunNote title — must NOT appear during keys-pending.
    expect(screen.queryByText(/your first results land here/i)).toBeNull();
  });
});
