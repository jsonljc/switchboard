import type {
  ConversationLifecycleSnapshot,
  ConversationLifecycleTransition,
  ConversationLifecycleState,
  ConversationLifecycleTrigger,
  ConversationLifecycleActor,
  LifecycleQualificationStatus,
} from "@switchboard/schemas";

/** Capabilities that unlock additional lifecycle states and triggers. */
export type LifecycleWriteCapability = "mechanical" | "qualification";

export interface LifecycleSnapshotStore {
  /** Read outside any transaction — used by event hooks for short-circuit checks
   *  (e.g. inbound-message hook checks `currentState !== 'stalled'` before opening
   *  a transaction). MUST NOT be relied on for precedence decisions. */
  read(threadId: string): Promise<ConversationLifecycleSnapshot | null>;
  /** Read inside a transaction — used by `LifecycleWriter.recordTransition` for
   *  the precedence re-check. With Prisma's default Read Committed isolation,
   *  this guarantees the snapshot we read is the same one we upsert in the
   *  same transaction, preventing the cron from overwriting a `booked` row that
   *  a concurrent booking write produced. */
  readInTransaction(tx: unknown, threadId: string): Promise<ConversationLifecycleSnapshot | null>;
  /** Upsert called only from inside `LifecycleWriter.recordTransition`'s transaction. */
  upsertInTransaction(tx: unknown, snapshot: ConversationLifecycleSnapshot): Promise<void>;
  /**
   * List all snapshots for an org where qualificationStatus is 'proposed_disqualified'
   * and currentState is not 'disqualified' (§8.1 doctrine predicate).
   * Used by the operator-facing pending-disqualifications API (Task 15).
   */
  listPendingDisqualifications(organizationId: string): Promise<ConversationLifecycleSnapshot[]>;
}

export interface LifecycleTransitionStore {
  /** Append a transition. `id` is omitted — the DB's `@default(cuid())` generates it. */
  appendInTransaction(
    tx: unknown,
    transition: Omit<ConversationLifecycleTransition, "id">,
  ): Promise<void>;
  listForThread(threadId: string): Promise<ConversationLifecycleTransition[]>;
  /**
   * Return the most recent transition for a thread with
   * trigger='system_proposed_disqualification', or null if none.
   * Used by the pending-list API to surface the proposal evidence.
   */
  findLatestProposal(conversationThreadId: string): Promise<ConversationLifecycleTransition | null>;
}

export interface MessageHistoryReader {
  /**
   * Returns timestamps of the last outbound and last inbound message for a thread.
   *
   * `lastOutboundAt` is the most recent outbound message regardless of sender — the
   * `ConversationMessage` schema has no actor column. For Phase 3a this is acceptable
   * because only `active` threads are swept and operators are blocked from `active`
   * (they trigger the `escalated` state).
   */
  read(threadId: string): Promise<{
    lastOutboundAt: Date | null;
    lastInboundAt: Date | null;
  }>;
}

/**
 * Resolves re-engagement attribution by querying `GovernanceVerdict` rows.
 * 1d emits a substitute verdict with `sourceGuard='whatsapp_window'`,
 * `action='substitute'`, and `details.intentClass='re-engagement-offer'`
 * (plus `details.metaTemplateName`) every time the gate replaces a free-form
 * response with a re-engagement template. We attribute by joining inbound
 * timing to the most recent matching verdict in the window. If 1d has not
 * yet shipped (or is flag-off) there will be no matching verdicts, and
 * `findReEngagementVerdict` returns null — the attributor falls back to
 * `inbound_after_stalled`.
 */
export interface ReEngagementVerdictReader {
  findReEngagementVerdict(
    threadId: string,
    inboundAt: Date,
    windowDays: number,
  ): Promise<{
    verdictId: string;
    templateName: string;
    decidedAt: Date;
  } | null>;
}

export interface RecordTransitionInput {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  toState: ConversationLifecycleState;
  trigger: ConversationLifecycleTrigger;
  actor: ConversationLifecycleActor;
  evidence: Record<string, unknown>;
  workTraceId?: string | null;
  occurredAt?: Date;
}

export interface UpdateQualificationInput {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  /** The target qualificationStatus. currentState is NOT advanced. */
  toQualificationStatus: LifecycleQualificationStatus;
  trigger: ConversationLifecycleTrigger;
  actor: ConversationLifecycleActor;
  evidence: Record<string, unknown>;
  workTraceId?: string | null;
  occurredAt?: Date;
}
