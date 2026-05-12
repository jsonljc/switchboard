import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleSnapshotStore } from "../types.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface ThreadFirstObservationEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  observedAt: Date;
  observationKind: "inbound_message" | "thread_create";
}

/**
 * Seeds the initial `null → active` snapshot for a thread. Without this, the
 * cron cannot transition any thread to `stalled` because
 * `canTransitionLifecycle(null, "stalled")` returns false (see Task 4).
 * Idempotent — exits cleanly when a snapshot already exists.
 *
 * Trigger choice: re-uses `inbound_after_stalled` rather than introducing a
 * 12th trigger value. Semantically the initial observation IS an inbound that
 * brings the thread to active. The `evidence.observation_kind` distinguishes
 * a true thread-init from a re-open.
 */
export async function onThreadFirstObservation(
  writer: LifecycleWriter,
  snapshotStore: LifecycleSnapshotStore,
  readMode: LifecycleModeReader,
  event: ThreadFirstObservationEvent,
): Promise<void> {
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  const existing = await snapshotStore.read(event.conversationThreadId);
  if (existing) return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "active",
    trigger: "inbound_after_stalled",
    actor: "system",
    evidence: { observation_kind: event.observationKind },
    occurredAt: event.observedAt,
  });
}
