import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityRow } from "../activity-row.js";

const baseRow: AuditEntryBrowseRow = {
  id: "audit_test_001",
  eventType: "action.executed",
  timestamp: "2026-05-10T06:23:11.000Z",
  actorType: "agent",
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_9921",
  riskCategory: "low",
  visibilityLevel: "org",
  summary: "Booked appointment for contact CTC:abcd1234",
  snapshotKeys: ["actionType"],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  previousEntryHash: null,
  envelopeId: null,
  traceId: null,
};

const NOW_MS = new Date("2026-05-10T06:24:11.000Z").getTime();

describe("ActivityRow", () => {
  it("renders time, event type, actor id, entity id, summary", () => {
    render(
      <ActivityRow
        row={baseRow}
        isOpen={false}
        isTarget={false}
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    expect(screen.getByText("06:23:11")).toBeInTheDocument();
    expect(screen.getByText("1m ago")).toBeInTheDocument();
    expect(screen.getByText("action.executed")).toBeInTheDocument();
    expect(screen.getByText("agent_alex_001")).toBeInTheDocument();
    expect(screen.getByText("cal_evt_9921")).toBeInTheDocument();
    expect(screen.getByText(/Booked appointment for contact/)).toBeInTheDocument();
  });

  it("H1: row body has no onClick handler and no role='button'", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ActivityRow
        row={baseRow}
        isOpen={false}
        isTarget={false}
        onToggle={onToggle}
        now={NOW_MS}
      />,
    );
    const row = container.querySelector("[data-rowid]");
    expect(row).toBeInTheDocument();
    expect(row?.getAttribute("role")).not.toBe("button");
    expect(row?.getAttribute("onclick")).toBeNull();
    expect(row?.getAttribute("tabindex")).toBeNull();
  });

  it("H1: clicking summary text does NOT toggle the drawer (regression guard)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRow
        row={baseRow}
        isOpen={false}
        isTarget={false}
        onToggle={onToggle}
        now={NOW_MS}
      />,
    );
    await user.click(screen.getByText(/Booked appointment for contact/));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("chevron button toggles drawer when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRow
        row={baseRow}
        isOpen={false}
        isTarget={false}
        onToggle={onToggle}
        now={NOW_MS}
      />,
    );
    await user.click(screen.getByRole("button", { name: /toggle details/i }));
    expect(onToggle).toHaveBeenCalledWith("audit_test_001");
  });

  it("chevron button toggles drawer when Enter or Space pressed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRow
        row={baseRow}
        isOpen={false}
        isTarget={false}
        onToggle={onToggle}
        now={NOW_MS}
      />,
    );
    const chevron = screen.getByRole("button", { name: /toggle details/i });
    chevron.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("event badge carries the correct data-band attribute per band", () => {
    const cases: Array<[AuditEntryBrowseRow["eventType"], string]> = [
      ["action.executed", "action"],
      ["identity.created", "identity"],
      ["event.published", "event"],
      ["agent.activated", "agent"],
    ];
    for (const [eventType, band] of cases) {
      const { container, unmount } = render(
        <ActivityRow
          row={{ ...baseRow, eventType }}
          isOpen={false}
          isTarget={false}
          onToggle={() => {}}
          now={NOW_MS}
        />,
      );
      expect(container.querySelector(`[data-band="${band}"]`)).toBeInTheDocument();
      unmount();
    }
  });

  it("actor glyph renders USR/AGT/SYS/SVC per actor type", () => {
    const cases: Array<[AuditEntryBrowseRow["actorType"], string]> = [
      ["user", "USR"],
      ["agent", "AGT"],
      ["system", "SYS"],
      ["service_account", "SVC"],
    ];
    for (const [actorType, glyph] of cases) {
      const { unmount } = render(
        <ActivityRow
          row={{ ...baseRow, actorType }}
          isOpen={false}
          isTarget={false}
          onToggle={() => {}}
          now={NOW_MS}
        />,
      );
      expect(screen.getByText(glyph)).toBeInTheDocument();
      unmount();
    }
  });

  it("row carries data-risk for each risk category", () => {
    const cases: Array<AuditEntryBrowseRow["riskCategory"]> = [
      "none",
      "low",
      "medium",
      "high",
      "critical",
    ];
    for (const risk of cases) {
      const { container, unmount } = render(
        <ActivityRow
          row={{ ...baseRow, riskCategory: risk }}
          isOpen={false}
          isTarget={false}
          onToggle={() => {}}
          now={NOW_MS}
        />,
      );
      expect(container.querySelector(`[data-risk="${risk}"]`)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders +N redacted pill when redactedKeyCount > 0", () => {
    render(
      <ActivityRow
        row={{ ...baseRow, redactedKeyCount: 5 }}
        isOpen={false}
        isTarget={false}
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    expect(screen.getByText(/\+5 redacted/i)).toBeInTheDocument();
  });

  it("does NOT render +N redacted pill when redactedKeyCount = 0", () => {
    render(
      <ActivityRow
        row={baseRow}
        isOpen={false}
        isTarget={false}
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    expect(screen.queryByText(/redacted/i)).not.toBeInTheDocument();
  });

  it("agent rows carry data-actor='agent' for the amber-treatment CSS rule (PR-B carry-over)", () => {
    const { container } = render(
      <ActivityRow
        row={{ ...baseRow, actorType: "agent" }}
        isOpen={false}
        isTarget={false}
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    expect(container.querySelector("[data-actor='agent']")).toBeInTheDocument();
  });
});
