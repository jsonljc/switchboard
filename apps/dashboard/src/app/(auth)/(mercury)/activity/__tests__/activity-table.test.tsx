import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityTable } from "../components/activity-table.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeRow = (overrides: Partial<AuditEntryBrowseRow> = {}): AuditEntryBrowseRow => ({
  id: "audit_row_001",
  eventType: "action.executed",
  timestamp: "2026-05-10T14:23:51.420Z",
  actorType: "agent",
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_9921",
  riskCategory: "low",
  visibilityLevel: "org",
  summary: "Booked appointment for contact",
  snapshotKeys: ["actionType", "decisionId"],
  redactedKeyCount: 3,
  evidencePointers: [
    {
      type: "pointer",
      hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      hashPrefix: "a1b2c3d4e5f6a1b2",
    },
  ],
  entryHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  previousEntryHash: "0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
  envelopeId: "env_001",
  traceId: "trace_001",
  ...overrides,
});

const ROW_1 = makeRow({ id: "audit_row_001", summary: "First row summary" });
const ROW_2 = makeRow({
  id: "audit_row_002",
  eventType: "action.rejected",
  summary: "Second row summary",
});
const ROWS = [ROW_1, ROW_2];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTable(expandedRowId: string | null = null) {
  const onToggleRow = vi.fn();
  const { container } = render(
    <ActivityTable rows={ROWS} expandedRowId={expandedRowId} onToggleRow={onToggleRow} />,
  );
  return { onToggleRow, container };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActivityTable", () => {
  it("renders the correct number of rows for the input array", () => {
    renderTable();
    // Each row has an aria-label on the chevron button
    const chevrons = screen.getAllByRole("button", { name: /Toggle details/ });
    expect(chevrons).toHaveLength(ROWS.length);
  });

  it("renders the correct column headers", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["TIMESTAMP", "EVENT", "ACTOR", "ENTITY", "SUMMARY", ""]);
  });

  it("row body click does NOTHING — clicking a summary cell does not call onToggleRow", async () => {
    const user = userEvent.setup();
    const { onToggleRow } = renderTable();

    // Find the summary cell for the first row and click it
    const summaryText = screen.getByText("First row summary");
    await user.click(summaryText);
    expect(onToggleRow).not.toHaveBeenCalled();
  });

  it("row body click on event cell does NOT call onToggleRow", async () => {
    const user = userEvent.setup();
    const { onToggleRow } = renderTable();

    // Click the event type text (should do nothing)
    const eventCell = screen.getAllByText("action.executed")[0];
    await user.click(eventCell);
    expect(onToggleRow).not.toHaveBeenCalled();
  });

  it("chevron <button> click calls onToggleRow with the row id", async () => {
    const user = userEvent.setup();
    const { onToggleRow } = renderTable();

    const chevron = screen.getByRole("button", { name: /Toggle details for entry audit_row_001/ });
    await user.click(chevron);
    expect(onToggleRow).toHaveBeenCalledWith("audit_row_001");
  });

  it("chevron has aria-expanded=false when not expanded", () => {
    renderTable(null);
    const chevron = screen.getByRole("button", { name: /Toggle details for entry audit_row_001/ });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("chevron has aria-expanded=true when expanded", () => {
    renderTable("audit_row_001");
    const chevron = screen.getByRole("button", { name: /Toggle details for entry audit_row_001/ });
    expect(chevron).toHaveAttribute("aria-expanded", "true");
  });

  it("chevron has aria-controls pointing at the drawer id", () => {
    renderTable();
    const chevron = screen.getByRole("button", { name: /Toggle details for entry audit_row_001/ });
    expect(chevron).toHaveAttribute("aria-controls", "activity-drawer-audit_row_001");
  });

  it("pressing Enter on the focused chevron triggers onToggleRow", async () => {
    const user = userEvent.setup();
    const { onToggleRow } = renderTable();

    const chevron = screen.getByRole("button", { name: /Toggle details for entry audit_row_001/ });
    chevron.focus();
    await user.keyboard("{Enter}");
    expect(onToggleRow).toHaveBeenCalledWith("audit_row_001");
  });

  it("pressing Space on the focused chevron triggers onToggleRow", async () => {
    const user = userEvent.setup();
    const { onToggleRow } = renderTable();

    const chevron = screen.getByRole("button", { name: /Toggle details for entry audit_row_001/ });
    chevron.focus();
    await user.keyboard(" ");
    expect(onToggleRow).toHaveBeenCalledWith("audit_row_001");
  });

  it("when expandedRowId matches a row, the drawer is rendered below that row", () => {
    renderTable("audit_row_001");
    // The drawer renders a region
    const drawer = screen.getByRole("region", { name: /Details for audit entry audit_row_001/ });
    expect(drawer).toBeInTheDocument();
  });

  it("when expandedRowId is null, no drawer region is rendered", () => {
    renderTable(null);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("only the expanded row has its drawer rendered — not other rows", () => {
    renderTable("audit_row_001");
    // Drawer for row 1 is present
    expect(
      screen.getByRole("region", { name: /Details for audit entry audit_row_001/ }),
    ).toBeInTheDocument();
    // Drawer for row 2 is absent
    expect(
      screen.queryByRole("region", { name: /Details for audit entry audit_row_002/ }),
    ).toBeNull();
  });

  it("renders the actor as type:id(0-8) mono-prefix in the table", () => {
    renderTable();
    // actorType:actorId.slice(0,8) => "agent:agent_al"
    expect(screen.getAllByText("agent:agent_al")[0]).toBeInTheDocument();
  });

  it("renders the entity as type:id(0-8) mono-prefix in the table", () => {
    renderTable();
    // entityType:entityId.slice(0,8) => "calendar_event:cal_evt_"
    expect(screen.getAllByText("calendar_event:cal_evt_")[0]).toBeInTheDocument();
  });

  it("renders summary truncated to 80 chars", () => {
    const longSummary =
      "A".repeat(90) + " this part should be cut off because it exceeds 80 characters total here";
    const row = makeRow({ id: "audit_trunc", summary: longSummary });
    render(<ActivityTable rows={[row]} expandedRowId={null} onToggleRow={() => {}} />);
    const summaryEl = screen.getByText("A".repeat(80));
    expect(summaryEl).toBeInTheDocument();
  });

  it("sticky-first-column class is applied to the TIMESTAMP column header", () => {
    const { container } = renderTable();
    const thead = container.querySelector("thead");
    expect(thead).not.toBeNull();
    const firstTh = thead!.querySelector("th");
    expect(firstTh).not.toBeNull();
    // The first th (TIMESTAMP) should have the stickyCol CSS module class
    // We check for the presence of a CSS class name containing "stickyCol" or "sticky"
    expect(firstTh!.className).toMatch(/stickyCol|sticky/i);
  });

  it("renders an empty tbody when rows=[]", () => {
    const { container } = render(
      <ActivityTable rows={[]} expandedRowId={null} onToggleRow={() => {}} />,
    );
    const tbody = container.querySelector("tbody");
    expect(tbody).not.toBeNull();
    expect(tbody!.children).toHaveLength(0);
  });
});
