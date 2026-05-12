import { describe, expect, it, vi } from "vitest";
import { onOperatorTakeover } from "../../event-hooks/operator-takeover-hook.js";

describe("onOperatorTakeover", () => {
  it("transitions to escalated with operator evidence", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const takenAt = new Date();
    await onOperatorTakeover(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      operatorId: "op-1",
      takenAt,
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "escalated",
        trigger: "operator_takeover",
        actor: "operator",
        evidence: { operator_id: "op-1", takeover_at: takenAt.toISOString() },
      }),
    );
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onOperatorTakeover(writer, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      operatorId: "op-1",
      takenAt: new Date(),
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
