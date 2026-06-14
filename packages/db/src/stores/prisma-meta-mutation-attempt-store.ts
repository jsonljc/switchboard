import type { PrismaDbClient } from "../prisma-db.js";

/** The marker state machine (Spec-1B spec section 3.1). */
export type MetaMutationAttemptStatus = "pending" | "applied" | "recovery_required";

export interface CreateMetaMutationAttemptInput {
  organizationId: string;
  adAccountId: string;
  campaignId: string;
  /** The execution work-unit id: the @unique replay key (one Meta edit per execution work unit). */
  executionWorkUnitId: string;
  status: MetaMutationAttemptStatus;
  /** Lease TTL: until this instant the row serializes other work units racing on the same campaign. */
  heldUntil: Date;
  observedPriorCents: number;
  requestedToCents: number;
  workTraceId?: string | null;
}

/**
 * Spec-1B PR 1B-1.4: the durable at-most-once marker AND campaign lease for the reallocation
 * executor. This slice ships the minimal surface the model needs - create (the marker the executor
 * commits in its OWN transaction immediately before the Meta write) and a replay-first lookup by
 * the unique work-unit key. The conditional-claim raw SQL lease (try-acquire / TTL-expiry) and the
 * status transitions to `applied` / `recovery_required` land with the real executor (PR 1B-1.5);
 * deliberately NOT pre-built here. A duplicate create raises P2002 (the executionWorkUnitId @unique):
 * the store does NOT swallow it, so the executor can replay rather than write the budget twice.
 */
export class PrismaMetaMutationAttemptStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateMetaMutationAttemptInput) {
    return this.prisma.metaMutationAttempt.create({
      data: {
        organizationId: input.organizationId,
        adAccountId: input.adAccountId,
        campaignId: input.campaignId,
        executionWorkUnitId: input.executionWorkUnitId,
        status: input.status,
        heldUntil: input.heldUntil,
        observedPriorCents: input.observedPriorCents,
        requestedToCents: input.requestedToCents,
        workTraceId: input.workTraceId ?? null,
      },
    });
  }

  /** Replay-first lookup the executor runs BEFORE any Meta call (PR 1B-1.5). */
  async findByExecutionWorkUnitId(executionWorkUnitId: string) {
    return this.prisma.metaMutationAttempt.findUnique({
      where: { executionWorkUnitId },
    });
  }
}
