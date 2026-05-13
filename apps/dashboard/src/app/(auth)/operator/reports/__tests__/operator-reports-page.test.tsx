import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Force fixture mode and stub session/connection accessors so the page mounts
// without real auth context. Mirrors the reports-page sibling test setup.
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
  isAgentHomeLinkLive: () => false,
}));
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

import { OperatorReportsPage } from "../operator-reports-page";

function renderWithQuery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OperatorReportsPage />
    </QueryClientProvider>,
  );
}

describe("OperatorReportsPage (fixture mode)", () => {
  it("renders without any bare $ in the DOM", () => {
    const { container } = renderWithQuery();
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });

  it("mounts the managed-comparison section for the populated goodFixture", () => {
    renderWithQuery();
    expect(screen.getByText(/How you're doing with us vs\. without/i)).toBeInTheDocument();
    expect(screen.getByText("Ads")).toBeInTheDocument();
  });

  it("renders the editorial title", () => {
    renderWithQuery();
    // "Operator" appears both in the title ("Operator's Statement.") and the
    // topbar user placeholder; both are correct.
    expect(screen.getAllByText(/Operator/).length).toBeGreaterThan(0);
    expect(screen.getByText("Statement")).toBeInTheDocument();
  });
});
