import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const haltState = { halted: false };
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: haltState.halted, setHalted: vi.fn(), toggleHalt: vi.fn() }),
  HaltProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const rileyApprovalsState = { approvals: [] as unknown[] };
vi.mock("@/hooks/use-riley-approvals", () => ({
  useRileyApprovals: () => ({
    approvals: rileyApprovalsState.approvals,
    isLoading: false,
    isError: false,
  }),
}));

const rileyStatusState = { status: "IDLE" as const };
vi.mock("@/hooks/use-riley-status", () => ({
  useRileyStatus: () => rileyStatusState.status,
}));

const rileyActivityState = { rows: [] as unknown[] };
vi.mock("@/hooks/use-riley-activity", () => ({
  useRileyActivity: () => ({ rows: rileyActivityState.rows, isLoading: false, isError: false }),
}));

import { RileyCockpitPage } from "../riley-cockpit-page";
import {
  pauseFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures";
import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows";

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("RileyCockpitPage", () => {
  it("renders Topbar with Riley tab present", () => {
    wrap(<RileyCockpitPage />);
    const tabs = screen.getAllByText("Riley");
    expect(tabs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders IDLE status pill in cold state", () => {
    rileyStatusState.status = "IDLE" as const;
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText(/IDLE/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders HALTED state when halt is active", () => {
    haltState.halted = true;
    (rileyStatusState as { status: string }).status = "HALTED";
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText(/HALTED/i).length).toBeGreaterThanOrEqual(1);
    haltState.halted = false;
    (rileyStatusState as { status: string }).status = "IDLE";
  });
});

// --- B.1 Task 17: data-driven end-to-end coverage ---

describe("RileyCockpitPage — data-driven states", () => {
  it("cold state: no Meta connection → 3 synthetic onboarding rows surface", () => {
    rileyActivityState.rows = coldStateActivityRows();
    (rileyStatusState as { status: string }).status = "IDLE";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Connect Meta Ads to begin/i)).toBeInTheDocument();
    expect(screen.getByText(/Set average lead value/i)).toBeInTheDocument();
    expect(screen.getByText(/Standing rules loaded/i)).toBeInTheDocument();
    rileyActivityState.rows = [];
  });

  it("steady state: 1 pending pause rec → WAITING pill + Pause card", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews([pauseFixture]);
    (rileyStatusState as { status: string }).status = "WAITING";
    wrap(<RileyCockpitPage />);
    expect(screen.getAllByText(/WAITING/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Pause adset/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(pauseFixture.humanSummary)).toBeInTheDocument();
    rileyApprovalsState.approvals = [];
    (rileyStatusState as { status: string }).status = "IDLE";
  });

  it("signal-health: 3 raw rows → 1 grouped account-level card; no 'Dismiss all' button", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews(signalHealthFixtures);
    (rileyStatusState as { status: string }).status = "WAITING";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Open Events Manager/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dismiss all/i)).not.toBeInTheDocument();
    rileyApprovalsState.approvals = [];
    (rileyStatusState as { status: string }).status = "IDLE";
  });

  it("composer placeholder responds to halted state", () => {
    haltState.halted = true;
    (rileyStatusState as { status: string }).status = "HALTED";
    wrap(<RileyCockpitPage />);
    // ComposerPlaceholder uses `halted` prop — verify the page renders without crashing
    // and the HALTED status pill appears (proxy for halted-mode rendering).
    expect(screen.getAllByText(/HALTED/i).length).toBeGreaterThanOrEqual(1);
    haltState.halted = false;
    (rileyStatusState as { status: string }).status = "IDLE";
  });
});
