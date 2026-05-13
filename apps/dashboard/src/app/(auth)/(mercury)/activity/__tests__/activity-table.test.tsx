import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityTable } from "../components/activity-table.js";

const makeRow = (overrides: Partial<AuditEntryBrowseRow>): AuditEntryBrowseRow => ({
  id: "audit_test_x",
  eventType: "action.executed",
  timestamp: "2026-05-10T06:23:11.000Z",
  actorType: "agent",
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_9921",
  riskCategory: "low",
  visibilityLevel: "org",
  summary: "Booked appointment",
  snapshotKeys: [],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "0xtargethash",
  previousEntryHash: null,
  envelopeId: null,
  traceId: null,
  ...overrides,
});

const NOW_MS = new Date("2026-05-10T06:30:00.000Z").getTime();

describe("ActivityTable", () => {
  it("renders ARIA grid roles: role='table', two rowgroups, columnheaders, rows", () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
    const { container } = render(
      <ActivityTable rows={rows} expandedId={null} onToggle={() => {}} now={NOW_MS} />,
    );
    expect(container.querySelector("[role='table']")).toBeInTheDocument();
    expect(container.querySelectorAll("[role='rowgroup']")).toHaveLength(2);
    expect(container.querySelectorAll("[role='columnheader']").length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll("[role='row']").length).toBeGreaterThanOrEqual(
      rows.length + 1,
    );
  });

  it("renders the drawer inline when expandedId matches a row id", () => {
    const rows = [makeRow({ id: "audit_a" }), makeRow({ id: "audit_b" })];
    render(<ActivityTable rows={rows} expandedId="audit_a" onToggle={() => {}} now={NOW_MS} />);
    expect(screen.getByRole("region", { name: /audit_a/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /audit_b/i })).not.toBeInTheDocument();
  });

  it("calls onToggle with the row id when chevron is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const rows = [makeRow({ id: "audit_a" })];
    render(<ActivityTable rows={rows} expandedId={null} onToggle={onToggle} now={NOW_MS} />);
    await user.click(screen.getByRole("button", { name: /toggle details/i }));
    expect(onToggle).toHaveBeenCalledWith("audit_a");
  });

  it("'view previous ↓' in an expanded drawer scrolls to the predecessor row", async () => {
    const user = userEvent.setup();
    const target = makeRow({ id: "audit_target", entryHash: "0xtargethash" });
    const child = makeRow({
      id: "audit_child",
      entryHash: "0xchildhash",
      previousEntryHash: "0xtargethash",
    });
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView — stub it on the prototype.
    Element.prototype.scrollIntoView = scrollSpy;
    render(
      <ActivityTable
        rows={[target, child]}
        expandedId="audit_child"
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    await user.click(screen.getByRole("button", { name: /view previous/i }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
