import type { LifecycleWriter } from "../lifecycle-writer.js";

export interface GovernanceVerdictEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  verdictId: string;
  action: string; // GovernanceVerdictActionSchema
  reasonCode: string;
}

export type LifecycleModeReader = (orgId: string) => Promise<"on" | "off">;

export async function onGovernanceVerdictWritten(
  writer: LifecycleWriter,
  readMode: LifecycleModeReader,
  event: GovernanceVerdictEvent,
): Promise<void> {
  if (event.action !== "escalate") return;
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "escalated",
    trigger: "governance_verdict_escalate",
    actor: "system",
    workTraceId: null,
    evidence: {
      verdict_id: event.verdictId,
      verdict_reason: event.reasonCode,
    },
  });
}
