import type { PrismaClient, MetaMutationAttempt } from "@prisma/client";

/** The marker state machine (Spec-1B spec section 3.1). */
export type MetaMutationAttemptStatus = "pending" | "applied" | "recovery_required";

/**
 * Advisory-lock namespace for reallocate campaign serialization. Distinct from the booking lock's
 * 920_001 (prisma-booking-store.ts) so the two never collide on the shared advisory-lock space.
 */
const REALLOCATE_LOCK_NS = 920_002;

/**
 * Lease TTL (spec section 3.3): a crashed executor's `pending` marker stops blocking other work
 * units on the same campaign once `heldUntil` passes, so the move becomes retryable. Two minutes is
 * comfortably longer than a Graph budget edit + the read-modify-re-read round trips.
 */
const LEASE_TTL_MS = 120_000;

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
  /** The reallocation's deployment, for the guardrail monitor's credential resolution + attribution. */
  deploymentId?: string | null;
}

export interface ClaimLeaseAndMarkInput {
  organizationId: string;
  adAccountId: string;
  campaignId: string;
  executionWorkUnitId: string;
  observedPriorCents: number;
  requestedToCents: number;
  workTraceId?: string | null;
  /** The reallocation's deployment, stamped so the guardrail monitor can resolve creds + attribute. */
  deploymentId?: string | null;
  /** The executor's execution clock; the active-lease probe compares heldUntil against it. */
  now: Date;
  /** Override the default lease TTL (tests/tuning). */
  leaseTtlMs?: number;
}

export type ClaimLeaseResult = { claimed: true; row: MetaMutationAttempt } | { claimed: false };

/** The forward guardrail monitor's verdict for an applied reallocation (mirrors the ad-optimizer
 *  ReallocationMonitorOutcome union); persisted to guardrailOutcome once a monitor pass resolves it. */
export type ReallocationGuardrailOutcome =
  | "held"
  | "rolled_back"
  | "rollback_noop"
  | "rollback_unrestorable";

/** One applied, un-monitored reallocation the guardrail monitor must evaluate. `appliedAt` is the
 *  markApplied time (updatedAt for an applied, guardrailOutcome-null row; applied is terminal until
 *  the monitor sets the outcome). `deploymentId` may be null only for legacy rows (none in prod). */
export interface PendingGuardrailReallocation {
  executionWorkUnitId: string;
  organizationId: string;
  deploymentId: string | null;
  adAccountId: string;
  campaignId: string;
  observedPriorCents: number;
  appliedAt: Date;
}

/**
 * Spec-1B: the durable at-most-once marker AND campaign serialization lease for the budget
 * reallocation executor (spec sections 3.1 + 3.3). The single `MetaMutationAttempt` row IS the
 * lease: `claimLeaseAndMark` advisory-locks the campaign (a transaction-scoped lock that spans NO
 * remote HTTP), refuses if an active marker already holds the campaign, else commits a `pending`
 * marker capturing the pre-write `observedPriorCents`. That committed row both serializes other work
 * units (its existence + `heldUntil` TTL) and is the point-of-no-return marker the post-write
 * transitions move to `applied` (success) or `recovery_required` (ambiguous). A duplicate
 * executionWorkUnitId raises P2002 (never swallowed) so the executor replays rather than double-writes.
 */
export class PrismaMetaMutationAttemptStore {
  constructor(private prisma: PrismaClient) {}

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
        deploymentId: input.deploymentId ?? null,
      },
    });
  }

  /** Replay-first lookup the executor runs BEFORE any Meta call (PR 1B-1.5). */
  async findByExecutionWorkUnitId(executionWorkUnitId: string) {
    return this.prisma.metaMutationAttempt.findUnique({
      where: { executionWorkUnitId },
    });
  }

  /**
   * Atomically acquire the campaign lease and commit the `pending` marker (executor §3.4 step 7).
   * A short transaction advisory-locks the campaign so the "no active marker" check and the INSERT
   * cannot race against a concurrent claim; the lock is released at commit and spans no Meta call.
   * Returns `{ claimed: false }` (→ LEASE_CONTENDED, retryable) when an active (pending or
   * recovery_required, unexpired) marker already holds the campaign.
   */
  async claimLeaseAndMark(input: ClaimLeaseAndMarkInput): Promise<ClaimLeaseResult> {
    const heldUntil = new Date(input.now.getTime() + (input.leaseTtlMs ?? LEASE_TTL_MS));
    const campaignKey = `${input.organizationId}:${input.adAccountId}:${input.campaignId}`;
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent claims on THIS campaign. ::int4 cast is mandatory (Prisma sends JS
      // numbers as bigint and pg_advisory_xact_lock(bigint, integer) does not exist); mirrors
      // prisma-booking-store.ts. xact-scoped: released at commit, never held across the Meta write.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REALLOCATE_LOCK_NS}::int4, hashtext(${campaignKey}))`;
      const active = await tx.metaMutationAttempt.findFirst({
        where: {
          organizationId: input.organizationId,
          adAccountId: input.adAccountId,
          campaignId: input.campaignId,
          status: { in: ["pending", "recovery_required"] },
          heldUntil: { gt: input.now },
        },
      });
      if (active) return { claimed: false };
      const row = await tx.metaMutationAttempt.create({
        data: {
          organizationId: input.organizationId,
          adAccountId: input.adAccountId,
          campaignId: input.campaignId,
          executionWorkUnitId: input.executionWorkUnitId,
          status: "pending",
          heldUntil,
          observedPriorCents: input.observedPriorCents,
          requestedToCents: input.requestedToCents,
          workTraceId: input.workTraceId ?? null,
          deploymentId: input.deploymentId ?? null,
        },
      });
      return { claimed: true, row };
    });
  }

  /**
   * Success transition (executor §3.4 step 10): flip the committed `pending` marker to `applied`,
   * which also releases the lease (an applied marker is no longer "active"). count===0 is a benign
   * no-op (already transitioned by a concurrent path / lazy expiry), never a throw.
   */
  async markApplied(args: {
    executionWorkUnitId: string;
    organizationId: string;
  }): Promise<{ transitioned: boolean }> {
    const res = await this.prisma.metaMutationAttempt.updateMany({
      where: {
        executionWorkUnitId: args.executionWorkUnitId,
        organizationId: args.organizationId,
        status: "pending",
      },
      data: { status: "applied" },
    });
    return { transitioned: res.count > 0 };
  }

  /**
   * Ambiguity transition (executor §3.4 steps 8-9): flip the committed `pending` marker to
   * `recovery_required`, which blocks auto-replay (the replay-first check returns
   * MUTATION_RECOVERY_REQUIRED) until an operator reconciles against Meta. count===0 is benign.
   */
  async markRecoveryRequired(args: {
    executionWorkUnitId: string;
    organizationId: string;
  }): Promise<{ transitioned: boolean }> {
    const res = await this.prisma.metaMutationAttempt.updateMany({
      where: {
        executionWorkUnitId: args.executionWorkUnitId,
        organizationId: args.organizationId,
        status: "pending",
      },
      data: { status: "recovery_required" },
    });
    return { transitioned: res.count > 0 };
  }

  // ───────────────────────── guardrail-monitoring queue (PR-3) ─────────────────────────

  /** The half-open "the contract window has elapsed" predicate the monitor queue shares: an applied,
   *  un-monitored row whose apply-time proxy (updatedAt) is at-or-before now - minWindowMs. */
  private pendingGuardrailWhere(now: Date, minWindowMs: number) {
    return {
      status: "applied",
      guardrailOutcome: null,
      updatedAt: { lte: new Date(now.getTime() - minWindowMs) },
    } as const;
  }

  /**
   * Distinct organizations with at least one applied, un-monitored reallocation whose contract window
   * has elapsed. The dispatch cron fans one monitor event per returned org (mirrors the
   * outcome-attribution dispatch). Empty when no org has self-executed, so the daily pass is inert.
   */
  async listOrgsWithPendingGuardrail(now: Date, minWindowMs: number): Promise<string[]> {
    const rows = await this.prisma.metaMutationAttempt.findMany({
      where: this.pendingGuardrailWhere(now, minWindowMs),
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    return rows.map((r) => r.organizationId);
  }

  /**
   * The applied, un-monitored reallocations for ONE org the monitor evaluates this pass. `appliedAt`
   * is the markApplied time (updatedAt; applied is terminal until the monitor sets guardrailOutcome).
   */
  async listPendingGuardrailForOrg(
    organizationId: string,
    now: Date,
    minWindowMs: number,
  ): Promise<PendingGuardrailReallocation[]> {
    const rows = await this.prisma.metaMutationAttempt.findMany({
      where: { organizationId, ...this.pendingGuardrailWhere(now, minWindowMs) },
      select: {
        executionWorkUnitId: true,
        organizationId: true,
        deploymentId: true,
        adAccountId: true,
        campaignId: true,
        observedPriorCents: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      executionWorkUnitId: r.executionWorkUnitId,
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      adAccountId: r.adAccountId,
      campaignId: r.campaignId,
      observedPriorCents: r.observedPriorCents,
      appliedAt: r.updatedAt,
    }));
  }

  /**
   * Record the monitor's verdict, first-writer-wins: only an applied, still-un-monitored row flips,
   * so two concurrent monitor passes on the same org cannot double-resolve. count===0 is a benign
   * no-op (already resolved by a concurrent pass), never a throw.
   */
  async markGuardrailOutcome(args: {
    executionWorkUnitId: string;
    organizationId: string;
    outcome: ReallocationGuardrailOutcome;
  }): Promise<{ transitioned: boolean }> {
    const res = await this.prisma.metaMutationAttempt.updateMany({
      where: {
        executionWorkUnitId: args.executionWorkUnitId,
        organizationId: args.organizationId,
        status: "applied",
        guardrailOutcome: null,
      },
      data: { guardrailOutcome: args.outcome },
    });
    return { transitioned: res.count > 0 };
  }
}
