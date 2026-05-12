import { describe, expect, it, vi } from "vitest";
import { onGovernanceVerdictWritten } from "../../event-hooks/governance-verdict-escalation-hook.js";

describe("onGovernanceVerdictWritten", () => {
  it("calls writer with escalated when verdict.action='escalate'", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onGovernanceVerdictWritten(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "regulated_claim_unsubstantiated",
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "escalated",
        trigger: "governance_verdict_escalate",
        actor: "system",
        workTraceId: null,
        evidence: expect.objectContaining({
          verdict_id: "v-1",
          verdict_reason: "regulated_claim_unsubstantiated",
        }),
      }),
    );
  });

  it("is a no-op when flag mode is off", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onGovernanceVerdictWritten(writer, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "anything",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("is a no-op when verdict.action !== 'escalate'", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onGovernanceVerdictWritten(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      verdictId: "v-1",
      action: "rewrite",
      reasonCode: "anything",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
