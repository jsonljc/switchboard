import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface OperatorTakeoverEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  operatorId: string;
  takenAt: Date;
}

export async function onOperatorTakeover(
  writer: LifecycleWriter,
  readMode: LifecycleModeReader,
  event: OperatorTakeoverEvent,
): Promise<void> {
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "escalated",
    trigger: "operator_takeover",
    actor: "operator",
    evidence: {
      operator_id: event.operatorId,
      takeover_at: event.takenAt.toISOString(),
    },
  });
}
