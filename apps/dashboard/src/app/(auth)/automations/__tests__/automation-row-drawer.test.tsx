import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutomationRowDrawer } from "../components/automation-row-drawer";
import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";

const SENTINEL = "REDACTION_PROBE_X9";

const baseRow: ScheduledTriggerBrowseRow = {
  id: "abcd-1234-uuid-rest",
  type: "cron",
  status: "active",
  scheduleLabel: "0 7 * * *",
  actionType: "spawn_workflow",
  sourceWorkflowId: "wf-uuid-12345678",
  createdAt: "2026-05-09T10:00:00.000Z",
  fireAt: null,
  expiresAt: "2026-06-01T00:00:00.000Z",
  drawer: {
    eventPatternSummary: null,
    visibleActionPayloadKeys: ["workflowId", "contactId"],
    redactedKeyCount: 2,
  },
};

describe("<AutomationRowDrawer />", () => {
  it("renders id, source workflow, schedule, action, dates, payload keys", () => {
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={baseRow} drawerId="drawer-row-1" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(screen.getByText("abcd-1234-uuid-rest")).toBeInTheDocument();
    expect(screen.getByText("wf-uuid-12345678")).toBeInTheDocument();
    expect(screen.getByText("0 7 * * *")).toBeInTheDocument();
    expect(screen.getByText("spawn_workflow")).toBeInTheDocument();
    expect(screen.getByText(/workflowId, contactId/)).toBeInTheDocument();
    expect(screen.getByText(/2 redacted/)).toBeInTheDocument();
  });

  it("renders an em-dash when there are no visible payload keys", () => {
    const row: ScheduledTriggerBrowseRow = {
      ...baseRow,
      drawer: { eventPatternSummary: null, visibleActionPayloadKeys: [], redactedKeyCount: 0 },
    };
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={row} drawerId="d2" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("payload-keys")).toHaveTextContent("—");
  });

  it("never renders a sentinel that could be in raw payload values", () => {
    const row: ScheduledTriggerBrowseRow = {
      ...baseRow,
      sourceWorkflowId: SENTINEL,
    };
    const { container } = render(
      <table>
        <tbody>
          <AutomationRowDrawer row={row} drawerId="d3" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(container.innerHTML).not.toMatch(/action\.payload|raw payload/);
    expect(container.textContent).toContain(SENTINEL);
  });

  it("contains no buttons whose accessible name suggests a mutation", () => {
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={baseRow} drawerId="d4" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    const mutationRegex = /Cancel|Edit|Delete|Pause|Reschedule/i;
    const buttons = screen.queryAllByRole("button");
    for (const b of buttons) {
      expect(b.getAttribute("aria-label") ?? b.textContent ?? "").not.toMatch(mutationRegex);
    }
  });

  it("provides copy-to-clipboard buttons for trigger id and source workflow", () => {
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={baseRow} drawerId="d5" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(screen.getByRole("button", { name: /Copy trigger id/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy source workflow id/i })).toBeInTheDocument();
  });
});
