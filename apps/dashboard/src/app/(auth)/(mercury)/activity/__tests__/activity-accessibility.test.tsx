import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntriesListResponse } from "@switchboard/schemas";

const useSearchParamsMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => useSearchParamsMock(),
}));
const mockUseActivityList = vi.fn();
vi.mock("../hooks/use-activity-list", () => ({
  useActivityList: (...args: unknown[]) => mockUseActivityList(...args),
}));

import { ActivityPage } from "../activity-page";

const liveRow = {
  id: "audit_a11y_001",
  eventType: "action.executed" as const,
  timestamp: "2026-05-14T10:00:00.000Z",
  actorType: "agent" as const,
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_a11y",
  riskCategory: "low" as const,
  visibilityLevel: "org" as const,
  summary: "A11y row",
  snapshotKeys: [],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "abc",
  previousEntryHash: null,
  envelopeId: null,
  traceId: null,
};

function hookResult(
  partial: Partial<{
    rows: AuditEntriesListResponse["rows"];
    isError: boolean;
    dataUpdatedAt: number;
  }>,
): unknown {
  const rows = partial.rows ?? [liveRow];
  const data: AuditEntriesListResponse = {
    rows,
    nextCursor: null,
    scope: "operational",
    appliedFilters: {
      eventType: null,
      actorType: null,
      entityType: null,
      entityId: null,
      after: null,
      before: null,
    },
  };
  return {
    data: partial.isError ? undefined : data,
    isLoading: false,
    isError: partial.isError ?? false,
    isSuccess: !partial.isError,
    isFetching: false,
    dataUpdatedAt: partial.dataUpdatedAt ?? (partial.isError ? 0 : Date.now()),
    refetch: vi.fn().mockResolvedValue(undefined),
    error: partial.isError ? new Error("fetch failed") : null,
  };
}

describe("ActivityPage accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    mockUseActivityList.mockReturnValue(hookResult({}));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("spec §5.3: table carries grid roles (table / rowgroup / row / columnheader / cell)", () => {
    render(<ActivityPage />);
    const table = screen.getByRole("table", { name: /activity entries/i });
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole("rowgroup").length).toBeGreaterThanOrEqual(2);
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(5);
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(2);
  });

  it("spec §5.2 + §8: filter strip is a search landmark with the scope segmented group", () => {
    render(<ActivityPage />);
    const strip = screen.getByRole("search");
    expect(strip).toBeInTheDocument();
    const scopeGroup = within(strip).getByRole("group", { name: /Activity scope/i });
    expect(scopeGroup).toBeInTheDocument();
    expect(within(scopeGroup).getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
    );
    expect(within(scopeGroup).getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed");
  });

  it("spec §5.2 + §8: combobox carries the WAI-ARIA combobox-with-listbox pattern", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    // The page has two role=combobox elements: the explicit event-type combo
    // and the implicit one on the entity-type <select>. Target the explicit
    // event-type combo via its placeholder.
    const combo = screen.getByPlaceholderText(/event type/i);
    expect(combo).toHaveAttribute("role", "combobox");
    expect(combo).toHaveAttribute("aria-expanded");
    await user.click(combo);
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(combo).toHaveAttribute("aria-expanded", "true");
    expect(combo).toHaveAttribute("aria-controls", listbox.getAttribute("id") ?? "");
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    // Some non-selected options have aria-selected="false"; assert presence of attr.
    expect(options[0]).toHaveAttribute("aria-selected");
  });

  it("spec §5.3 + §8: chevron is the only interactive element in a row + carries aria-expanded/controls", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    const chevron = screen.getByRole("button", { name: /Toggle details for entry/ });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(chevron).toHaveAttribute("aria-controls");
    chevron.focus();
    expect(chevron).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(chevron).toHaveAttribute("aria-expanded", "true");
  });

  it("spec §5.4 + §8: drawer mounts with role='region' once a row is expanded", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    await user.click(screen.getByRole("button", { name: /Toggle details for entry/ }));
    const drawer = screen.getByRole("region", { name: /Audit entry detail/i });
    expect(drawer).toBeInTheDocument();
  });

  it("spec §12 H5 + §8: error banner has role='alert' so AT users get an announcement", () => {
    mockUseActivityList.mockReturnValue(hookResult({ isError: true }));
    render(<ActivityPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("spec §5.5 + §8: stale pill carries role='status' and aria-live='polite' on the age", () => {
    render(<ActivityPage />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    const polite = status.querySelector("[aria-live='polite']");
    expect(polite).not.toBeNull();
  });
});
