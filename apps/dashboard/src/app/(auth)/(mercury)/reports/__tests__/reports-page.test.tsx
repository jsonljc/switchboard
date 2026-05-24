import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Force fixture mode AND a stub useScopedQueryKeys/useConnections so the page
// can mount without a real auth/org context.
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
  isAgentHomeLinkLive: () => false,
}));
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null, // disables react-query fetches downstream
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

import { ReportsPage } from "../reports-page";

function renderWithQuery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

describe("ReportsPage (fixture mode, default THIS MONTH)", () => {
  it("renders without any bare $ in the DOM", () => {
    const { container } = renderWithQuery();
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });

  it("does not render 'schema · reports/v1' anywhere", () => {
    const { container } = renderWithQuery();
    expect(container.textContent).not.toMatch(/schema\s*·\s*reports\/v1/i);
    expect(container.textContent).not.toMatch(/reports\/v1/);
  });

  it("renders the hero number 14,720 for the default goodFixture", () => {
    renderWithQuery();
    // "14,720" appears in both the hero number and the pull quote — both are correct.
    expect(screen.getAllByText(/14,720/).length).toBeGreaterThan(0);
  });

  it("renders 'Salesperson + ad agency' (not 'SDR + agency alt.')", () => {
    renderWithQuery();
    expect(screen.getByText(/Salesperson \+ ad agency/i)).toBeInTheDocument();
    expect(screen.queryByText(/SDR \+ agency alt/i)).toBeNull();
  });

  it("renders 'Revenue we drove' eyebrow", () => {
    renderWithQuery();
    // The eyebrow uses the friendly phrasing. The pull quote may still contain
    // the legacy "attributed pipeline" string from backend-generated copy; that
    // copy lives in pullquote.{pre,mid,post} and is out of scope for this PR.
    expect(screen.getByText(/Revenue we drove/i)).toBeInTheDocument();
  });

  it("never shows the no-connection banner in fixture mode", () => {
    renderWithQuery();
    expect(screen.queryByText(/no meta ads connection/i)).toBeNull();
  });

  it("renders the fixture-mode demo-data banner (no Topbar — unified shell header handles brand/nav)", () => {
    // The reports-local Topbar was removed in favour of the unified app-header.
    // Fixture mode is now indicated by the FixtureModeBanner ("Demo data" label).
    renderWithQuery();
    expect(screen.getByText(/Demo data/i)).toBeInTheDocument();
  });

  it("renders Refresh button (not Recompute)", () => {
    renderWithQuery();
    expect(screen.getByRole("button", { name: /^Refresh$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Recompute/i })).toBeNull();
  });

  it("renders the ManagedComparison section (goodFixture has populated managedComparison)", () => {
    renderWithQuery();
    expect(screen.getByText(/How you're doing with us vs\. without/i)).toBeInTheDocument();
    expect(screen.getByText("Ads")).toBeInTheDocument();
    // "Conversations" appears twice: Alex's role in the attribution split AND the
    // managed-comparison column eyebrow. Assert at least one.
    expect(screen.getAllByText("Conversations").length).toBeGreaterThan(0);
  });

  it("window selector exposes three buttons with aria-pressed semantics", () => {
    renderWithQuery();
    expect(screen.getByRole("button", { name: "THIS MONTH" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "THIS WEEK" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "THIS QUARTER" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  // Note: a broad innerHTML scan for /red|green/ was deliberately not added
  // here — see plan revision R4. Performance-color discipline is enforced by
  // the CSS-side test at css-no-perf-red-green.test.ts; live-status dots may
  // use green.
});
