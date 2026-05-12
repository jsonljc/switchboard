import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleSnapshotStore } from "../types.js";
import type { ReEngagementAttributor } from "../re-engagement-attributor.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface InboundMessageEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  receivedAt: Date;
}

export async function onInboundMessage(
  writer: LifecycleWriter,
  snapshotStore: LifecycleSnapshotStore,
  attributor: ReEngagementAttributor,
  readMode: LifecycleModeReader,
  event: InboundMessageEvent,
): Promise<void> {
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  const snap = await snapshotStore.read(event.conversationThreadId);
  if (!snap) return;
  if (snap.currentState !== "stalled") return;
  const attribution = await attributor.attributeReOpen(
    event.conversationThreadId,
    event.receivedAt,
  );
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "active",
    trigger: attribution.trigger,
    actor: "system",
    evidence: attribution.evidence,
  });
}
