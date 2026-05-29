import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseReportData } from "../hooks/use-report-data";
import { goodFixture } from "../fixtures";

vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => true,
  isAgentHomeLinkLive: () => false,
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({
    data: { connections: [{ serviceId: "meta-ads", status: "connected" }] },
    isLoading: false,
  }),
}));

const hookState: { current: UseReportData } = {
  current: {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refresh: async () => {},
    retry: vi.fn(async () => {}),
  },
};
vi.mock("../hooks/use-report-data", () => ({
  useReportData: () => hookState.current,
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

describe("ReportsPage (live mode failure states, #472)", () => {
  beforeEach(() => {
    hookState.current = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      refresh: async () => {},
      retry: vi.fn(async () => {}),
    };
  });

  it("renders the skeleton when there is no data and no error (not a blank body)", () => {
    // The page branches on {data, error}, not isLoading — no data + no error is
    // the loading/not-ready catch-all. (Real loading-vs-pending coverage lives
    // in reports-page-pending.test.tsx, which drives the real hook.)
    hookState.current = { ...hookState.current, data: undefined, error: null };
    renderPage();
    expect(screen.getByLabelText(/loading report/i)).toBeInTheDocument();
  });

  it("renders the unavailable state on error with no data (not blank, not a crash)", () => {
    hookState.current = { ...hookState.current, error: new Error("500") };
    renderPage();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it("never shows fixture content in the live error state", () => {
    hookState.current = { ...hookState.current, error: new Error("500") };
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/14,720/);
  });

  it("retry button click calls the hook retry", async () => {
    const retry = vi.fn(async () => {});
    hookState.current = { ...hookState.current, error: new Error("500"), retry };
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the report AND a stale banner when data is present but refresh errored", () => {
    hookState.current = { ...hookState.current, data: goodFixture, error: new Error("500") };
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
    // report still rendered
    expect(screen.getAllByText(/14,720/).length).toBeGreaterThan(0);
  });

  it("renders the report cleanly when data is present and no error", () => {
    hookState.current = { ...hookState.current, data: goodFixture };
    renderPage();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByText(/14,720/).length).toBeGreaterThan(0);
  });
});
