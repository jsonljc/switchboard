/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { RightDrawerProvider } from "@/components/layout/right-drawer-context";
import { PipelinePage } from "../pipeline-page";

// Live mode, but the session/org keys are not resolved yet (useScopedQueryKeys
// returns null). This is the REAL React Query `enabled: false` pending state —
// data undefined, error null, isLoading false — that previously fell through to
// WholeBoardEmpty (a dishonest "no deals" message while the query had not run).
// See MEMORY feedback_react_query_enabled_false_isloading.
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => true }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RightDrawerProvider>
        <PipelinePage />
      </RightDrawerProvider>
    </QueryClientProvider>,
  );
}

describe("PipelinePage (live mode, session keys not yet resolved)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a loading skeleton — never the whole-board empty state — while keys are null", () => {
    renderPage();
    expect(screen.getByRole("status", { name: /loading pipeline/i })).toBeInTheDocument();
    expect(screen.queryByText(/No deals in your pipeline yet/i)).toBeNull();
  });
});
