import {
  type ConversationLifecycleSnapshot,
  type ConversationLifecycleTransition,
  type LifecycleQualificationStatus,
} from "@switchboard/schemas";
import type {
  LifecycleSnapshotStore,
  LifecycleTransitionStore,
  RecordTransitionInput,
  UpdateQualificationInput,
  LifecycleWriteCapability,
} from "./types.js";
import { canTransitionLifecycle } from "./precedence.js";
import { allowedStatesFor, allowedTriggersFor } from "./constants.js";
import { LifecycleCapabilityDenied } from "./errors.js";

export type RunInTransaction = <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;

export interface LifecycleWriterDeps {
  snapshotStore: LifecycleSnapshotStore;
  transitionStore: LifecycleTransitionStore;
  runInTransaction: RunInTransaction;
  /** Resolves the writer's enabled capabilities for the given org. */
  resolveCapabilities: (organizationId: string) => Promise<ReadonlySet<LifecycleWriteCapability>>;
}

export class LifecycleWriter {
  constructor(private readonly deps: LifecycleWriterDeps) {}

  async recordTransition(input: RecordTransitionInput): Promise<void> {
    // Capability-aware allowlist guard. The schema permits the full Phase 3 enum
    // for forward compatibility; the caller's resolved capability set determines
    // which states and triggers are actually permitted. Throw — never silently
    // drop — so that any caller accidentally reaching for an out-of-capability
    // value fails loudly in test/dev.
    const caps = await this.deps.resolveCapabilities(input.organizationId);
    const states = allowedStatesFor(caps);
    const triggers = allowedTriggersFor(caps);

    if (!states.has(input.toState)) {
      throw new LifecycleCapabilityDenied(
        `toState '${input.toState}' is not permitted by current capabilities`,
      );
    }
    if (!triggers.has(input.trigger)) {
      throw new LifecycleCapabilityDenied(
        `trigger '${input.trigger}' is not permitted by current capabilities`,
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

      // Spec §5.2 monotonic table: recordTransition advances qualificationStatus on
      // rule-pass triggers. Mechanical triggers carry the existing status across unchanged.
      const qualificationStatusForTransition = ((): LifecycleQualificationStatus => {
        if (input.trigger === "qualification_checklist_met") {
          // unknown/unqualified → qualified (re-affirm on qualified is idempotent).
          return "qualified";
        }
        if (input.trigger === "qualification_checklist_failed") {
          // §5.2: only unknown → unqualified is permitted; qualified must never regress.
          return existing?.qualificationStatus === "unknown"
            ? "unqualified"
            : (existing?.qualificationStatus ?? "unknown");
        }
        // All other triggers (mechanical): carry the existing status unchanged.
        return existing?.qualificationStatus ?? "unknown";
      })();

      const nextSnapshot: ConversationLifecycleSnapshot = {
        conversationThreadId: input.conversationThreadId,
        organizationId: input.organizationId,
        contactId: input.contactId,
        currentState: input.toState,
        qualificationStatus: qualificationStatusForTransition,
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

  /**
   * Mutates `qualificationStatus` on the snapshot WITHOUT advancing `currentState`.
   * Used by qualification-evaluation sidecar (system proposes) and
   * disqualification-resolution hook (operator dismisses).
   *
   * Capability violations throw `LifecycleCapabilityDenied` (loud).
   * Monotonic violations are silently dropped (expected behavior, not bugs).
   */
  async updateQualificationStatus(input: UpdateQualificationInput): Promise<void> {
    const capabilities = await this.deps.resolveCapabilities(input.organizationId);
    const triggers = allowedTriggersFor(capabilities);
    if (!triggers.has(input.trigger)) {
      throw new LifecycleCapabilityDenied(
        `trigger '${input.trigger}' not allowed by capabilities [${[...capabilities].join(",")}]`,
      );
    }

    const occurredAt = input.occurredAt ?? new Date();

    await this.deps.runInTransaction(async (tx) => {
      const existing = await this.deps.snapshotStore.readInTransaction(
        tx,
        input.conversationThreadId,
      );
      if (existing === null) {
        console.warn(
          `[lifecycle] updateQualificationStatus called on missing snapshot ${input.conversationThreadId}; ignoring`,
        );
        return;
      }
      if (!isMonotonicQualificationTransition(existing.qualificationStatus, input)) {
        return; // silent no-op
      }

      const nextSnapshot: ConversationLifecycleSnapshot = {
        ...existing,
        qualificationStatus: input.toQualificationStatus,
        lastEvaluatedAt: occurredAt,
        updatedAt: occurredAt,
      };
      await this.deps.snapshotStore.upsertInTransaction(tx, nextSnapshot);

      const transition: Omit<ConversationLifecycleTransition, "id"> = {
        organizationId: input.organizationId,
        conversationThreadId: input.conversationThreadId,
        contactId: input.contactId,
        fromState: existing.currentState,
        toState: existing.currentState,
        trigger: input.trigger,
        evidence: input.evidence,
        actor: input.actor,
        workTraceId: input.workTraceId ?? null,
        occurredAt,
      };
      await this.deps.transitionStore.appendInTransaction(tx, transition);
    });
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

function isMonotonicQualificationTransition(
  current: LifecycleQualificationStatus,
  input: UpdateQualificationInput,
): boolean {
  const target = input.toQualificationStatus;
  const trigger = input.trigger;

  // Operator-driven paths bypass the monotonic-by-sidecar rules.
  if (trigger === "operator_dismissed_disqualification") {
    return current === "proposed_disqualified";
  }
  if (trigger === "operator_confirmed_disqualification") {
    // Handled by recordTransition (advances currentState to disqualified).
    return false;
  }

  // System paths from sidecar evaluation:
  if (current === "proposed_disqualified" && trigger !== "system_proposed_disqualification") {
    return false; // protected from overwrite by normal sidecars
  }

  if (target === "proposed_disqualified") {
    return current !== "proposed_disqualified";
  }

  if (target === "qualified") {
    return current === "unknown" || current === "unqualified" || current === "qualified";
  }

  if (target === "unqualified") {
    return current === "unknown"; // qualified → unqualified is forbidden
  }

  if (target === "unknown") {
    return false; // never regress to unknown
  }

  return false;
}
