import {
  type ConversationLifecycleSnapshot,
  type ConversationLifecycleTransition,
} from "@switchboard/schemas";
import type {
  LifecycleSnapshotStore,
  LifecycleTransitionStore,
  RecordTransitionInput,
} from "./types.js";
import { canTransitionLifecycle } from "./precedence.js";
import { THREE_A_ALLOWED_STATES, THREE_A_ALLOWED_TRIGGERS } from "./constants.js";

export type RunInTransaction = <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;

export interface LifecycleWriterDeps {
  snapshotStore: LifecycleSnapshotStore;
  transitionStore: LifecycleTransitionStore;
  runInTransaction: RunInTransaction;
}

export class LifecycleWriter {
  constructor(private readonly deps: LifecycleWriterDeps) {}

  async recordTransition(input: RecordTransitionInput): Promise<void> {
    // 3a runtime allowlist guard. Schema permits the full Phase 3 enum for
    // forward compatibility, but 3a code paths must only emit mechanical states
    // and 3a triggers. Throw — never silently drop — so that any 3a caller
    // accidentally reaching for a 3b value fails loudly in test/dev.
    if (!THREE_A_ALLOWED_STATES.has(input.toState)) {
      throw new Error(
        `LifecycleWriter (3a): toState '${input.toState}' is not in THREE_A_ALLOWED_STATES`,
      );
    }
    if (!THREE_A_ALLOWED_TRIGGERS.has(input.trigger)) {
      throw new Error(
        `LifecycleWriter (3a): trigger '${input.trigger}' is not in THREE_A_ALLOWED_TRIGGERS`,
      );
    }

    const occurredAt = input.occurredAt ?? new Date();
    await this.deps.runInTransaction(async (tx) => {
      // Read inside the transaction so the precedence decision sees the same
      // snapshot we are about to upsert. Prisma's default Read Committed
      // isolation guarantees this consistency for the read+upsert+append trio.
      const existing = await this.deps.snapshotStore.readInTransaction(
        tx,
        input.conversationThreadId,
      );
      const fromState = existing?.currentState ?? null;
      if (!canTransitionLifecycle(fromState, input.toState)) {
        return;
      }

      const nextSnapshot: ConversationLifecycleSnapshot = {
        conversationThreadId: input.conversationThreadId,
        organizationId: input.organizationId,
        contactId: input.contactId,
        currentState: input.toState,
        qualificationStatus: existing?.qualificationStatus ?? "unknown",
        bookingStatus:
          input.toState === "booked" ? "booked" : (existing?.bookingStatus ?? "not_booked"),
        dropoffReason: this.computeDropoffReason(input, existing?.dropoffReason ?? null),
        lastTransitionAt: occurredAt,
        lastEvaluatedAt: occurredAt,
        updatedAt: occurredAt,
      };
      await this.deps.snapshotStore.upsertInTransaction(tx, nextSnapshot);

      // id omitted — Prisma's @default(cuid()) on the model generates it.
      // Keeping id generation in one place (the DB) avoids two competing
      // conventions in the codebase.
      const transition: Omit<ConversationLifecycleTransition, "id"> = {
        organizationId: input.organizationId,
        conversationThreadId: input.conversationThreadId,
        contactId: input.contactId,
        fromState,
        toState: input.toState,
        trigger: input.trigger,
        evidence: input.evidence,
        actor: input.actor,
        workTraceId: input.workTraceId ?? null,
        occurredAt,
      };
      await this.deps.transitionStore.appendInTransaction(tx, transition);
    });
  }

  /** Recover the snapshot by replaying the transition log. */
  async rebuildSnapshotFromTransitions(
    threadId: string,
  ): Promise<ConversationLifecycleSnapshot | null> {
    const transitions = await this.deps.transitionStore.listForThread(threadId);
    if (transitions.length === 0) return null;
    let snap: ConversationLifecycleSnapshot | null = null;
    for (const t of transitions) {
      const fromState: ConversationLifecycleSnapshot["currentState"] | null =
        snap === null ? null : snap.currentState;
      if (!canTransitionLifecycle(fromState, t.toState)) continue;
      const priorQualification: ConversationLifecycleSnapshot["qualificationStatus"] =
        snap === null ? "unknown" : snap.qualificationStatus;
      const priorBooking: ConversationLifecycleSnapshot["bookingStatus"] =
        snap === null ? "not_booked" : snap.bookingStatus;
      const priorDropoff: ConversationLifecycleSnapshot["dropoffReason"] =
        snap === null ? null : snap.dropoffReason;
      snap = {
        conversationThreadId: t.conversationThreadId,
        organizationId: t.organizationId,
        contactId: t.contactId,
        currentState: t.toState,
        qualificationStatus: priorQualification,
        bookingStatus: t.toState === "booked" ? "booked" : priorBooking,
        dropoffReason: this.computeDropoffReason(
          {
            organizationId: t.organizationId,
            conversationThreadId: t.conversationThreadId,
            contactId: t.contactId,
            toState: t.toState,
            trigger: t.trigger,
            actor: t.actor,
            evidence: t.evidence,
          },
          priorDropoff,
        ),
        lastTransitionAt: t.occurredAt,
        lastEvaluatedAt: t.occurredAt,
        updatedAt: t.occurredAt,
      };
    }
    return snap;
  }

  private computeDropoffReason(
    input: RecordTransitionInput,
    prior: ConversationLifecycleSnapshot["dropoffReason"],
  ): ConversationLifecycleSnapshot["dropoffReason"] {
    if (input.toState === "stalled" && input.trigger === "timer_24h_no_inbound") return "no_reply";
    if (input.toState === "booked") return null;
    if (input.toState === "active") return null;
    return prior;
  }
}
