import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  AgentKey,
  PersistRecommendationInput,
  Recommendation,
  RecommendationStatus,
  RecommendationStore,
  RecommendationSurface,
} from "@switchboard/core";
import { RecommendationStaleStatusError } from "@switchboard/core";

const RECOMMENDATION_INTENT_PREFIX = "recommendation.";

interface RecommendationRiskContract {
  riskLevel?: string;
  externalEffect?: boolean;
  financialEffect?: boolean;
  clientFacing?: boolean;
  requiresConfirmation?: boolean;
}

interface RecommendationParams {
  __recommendation?: {
    action?: string;
    note?: string | null;
    presentation?: unknown;
    riskContract?: RecommendationRiskContract;
    /** Slice 4f: WorkUnit.id of the machine execution that acted this rec. */
    executedWorkUnitId?: string;
  };
  [key: string]: unknown;
}

/** Result of the machine-execution transition (slice 4f). "not_pending" and
 * "not_found" are benign first-writer-wins no-ops, never errors. */
export type MarkActedByExecutionResult =
  | { transitioned: true }
  | { transitioned: false; reason: "not_found" | "not_pending" };

/**
 * Project a Prisma `pendingActionRecord` row into the canonical `Recommendation`
 * read shape. Exported because PrismaRecommendationEmissionMirror also needs
 * this projection — see packages/db/src/stores/prisma-recommendation-emission-mirror.ts.
 * Both call sites must use the same projection or future schema additions will
 * silently surface as shape divergence between the idempotent path and the
 * fresh path.
 */
export function rowToRecommendation(row: {
  id: string;
  organizationId: string;
  sourceAgent: string;
  intent: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: string;
  surface: string;
  status: string;
  parameters: unknown;
  targetEntities: unknown;
  sourceWorkflow: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  undoableUntil: Date | null;
}): Recommendation {
  const params = (row.parameters ?? {}) as RecommendationParams;
  const meta = params.__recommendation ?? {};
  // Read risk-contract booleans back from the JSONB stash (written by emit.ts).
  // Legacy rows that predate E1 will have no `riskContract` key — leave the fields
  // as `undefined` so the adapter's `?? false` fallback applies correctly.
  const rc = meta.riskContract;
  return {
    id: row.id,
    orgId: row.organizationId,
    agentKey: row.sourceAgent as AgentKey,
    intent: row.intent,
    action: meta.action ?? "",
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    dollarsAtRisk: row.dollarsAtRisk,
    riskLevel: row.riskLevel as Recommendation["riskLevel"],
    externalEffect: rc?.externalEffect,
    financialEffect: rc?.financialEffect,
    clientFacing: rc?.clientFacing,
    requiresConfirmation: rc?.requiresConfirmation,
    surface: row.surface as RecommendationSurface,
    status: row.status as RecommendationStatus,
    parameters: params,
    targetEntities: (row.targetEntities ?? null) as Record<string, unknown> | null,
    sourceAgent: row.sourceAgent,
    sourceWorkflow: row.sourceWorkflow,
    actedBy: row.resolvedBy,
    actedAt: row.resolvedAt,
    note: meta.note ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    undoableUntil: row.undoableUntil,
  };
}

function buildEntryHash(args: {
  id: string;
  fromStatus: string;
  toStatus: string;
  principalId: string;
  ts: number;
}): string {
  return createHash("sha256")
    .update(
      [args.id, args.fromStatus, args.toStatus, args.principalId, args.ts, randomUUID()].join(":"),
    )
    .digest("hex");
}

export class PrismaRecommendationStore implements RecommendationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(
    input: PersistRecommendationInput,
  ): Promise<{ row: Recommendation; idempotent: boolean }> {
    try {
      const row = await this.prisma.pendingActionRecord.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          status: "pending",
          intent: input.intent,
          targetEntities: (input.targetEntities ?? {}) as object,
          parameters: input.parameters as object,
          humanSummary: input.humanSummary,
          confidence: input.confidence,
          riskLevel: input.riskLevel,
          dollarsAtRisk: input.dollarsAtRisk,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "operator",
          sourceAgent: input.agentKey,
          sourceWorkflow: input.sourceWorkflow ?? null,
          organizationId: input.orgId,
          surface: input.surface,
          undoableUntil: input.undoableUntil,
          expiresAt: input.expiresAt,
        },
      });
      return { row: rowToRecommendation(row), idempotent: false };
    } catch (err: unknown) {
      // P2002 = unique constraint failure on idempotencyKey.
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        const existing = await this.prisma.pendingActionRecord.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) return { row: rowToRecommendation(existing), idempotent: true };
      }
      throw err;
    }
  }

  async getById(id: string): Promise<Recommendation | null> {
    const row = await this.prisma.pendingActionRecord.findUnique({ where: { id } });
    if (!row || !row.intent.startsWith(RECOMMENDATION_INTENT_PREFIX)) return null;
    return rowToRecommendation(row);
  }

  async listBySurface(args: {
    orgId: string;
    surface: Exclude<RecommendationSurface, "dropped">;
    status?: RecommendationStatus;
    sinceMs?: number;
    limit?: number;
  }): Promise<Recommendation[]> {
    const since = args.sinceMs ? new Date(Date.now() - args.sinceMs) : undefined;
    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        organizationId: args.orgId,
        surface: args.surface,
        intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        ...(args.status ? { status: args.status } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(args.limit ?? 50, 200),
    });
    return rows.map(rowToRecommendation);
  }

  /**
   * Generic store method: filters terminal recommendations by org + agent +
   * any subset of statuses + resolvedAt window. The wins projection narrows
   * `statuses` to ["acted", "confirmed"] at its single call site; do not pass
   * arbitrary statuses from new external callers without thinking about
   * what "win" means in their context.
   */
  async listResolvedForAgent(args: {
    orgId: string;
    agentKey: AgentKey;
    statuses: readonly RecommendationStatus[];
    resolvedSince: Date;
    limit: number;
  }): Promise<Recommendation[]> {
    // Semantically "resolved wins": rows must have a non-null resolvedAt.
    // We assert `not: null` explicitly even though `gte: <Date>` already
    // excludes nulls in Prisma — explicit beats implicit.
    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        organizationId: args.orgId,
        sourceAgent: args.agentKey,
        status: { in: [...args.statuses] },
        resolvedAt: { not: null, gte: args.resolvedSince },
        intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
      },
      orderBy: { resolvedAt: "desc" },
      take: Math.max(0, Math.min(args.limit, 200)),
    });
    return rows.map(rowToRecommendation);
  }

  /**
   * D7-2: aggregate the org's resolved operator verdicts by action kind into
   * `{ approved, rejected }` counts (DB status `acted` -> approved, `dismissed` ->
   * rejected). The read side of Riley's first learning wire: the confidence modifier
   * (packages/ad-optimizer/src/confidence-modifier.ts) turns this into a bounded,
   * abstaining prior on the next cycle's recommendation confidence.
   *
   * Scope: org-only, resolved (`resolvedAt not null`), recommendation-intent rows whose
   * status is a verdict (`acted`/`dismissed`). `confirmed`/`dismissed_by_undo`/`expired`
   * are NOT operator approve/reject verdicts and are excluded. Read-only (no mutation, so
   * no route-allowlist concern). The action kind lives in the JSONB stash
   * (`parameters.__recommendation.action`), which Prisma cannot `groupBy`, so we group in
   * memory; a row with no action kind is skipped (never fabricates a bucket).
   */
  async aggregateApprovalRateByKind(
    orgId: string,
  ): Promise<Map<string, { approved: number; rejected: number }>> {
    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        organizationId: orgId,
        intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        resolvedAt: { not: null },
        status: { in: ["acted", "dismissed"] },
      },
      select: { parameters: true, status: true },
    });
    const agg = new Map<string, { approved: number; rejected: number }>();
    for (const row of rows) {
      const params = (row.parameters ?? {}) as RecommendationParams;
      const action = params.__recommendation?.action;
      if (!action) continue;
      const counts = agg.get(action) ?? { approved: 0, rejected: 0 };
      if (row.status === "acted") counts.approved += 1;
      else if (row.status === "dismissed") counts.rejected += 1;
      agg.set(action, counts);
    }
    return agg;
  }

  async applyAct(args: {
    id: string;
    orgId: string;
    actor: { principalId: string; type: "operator" };
    fromStatus: RecommendationStatus;
    toStatus: RecommendationStatus;
    note: string | undefined;
  }): Promise<Recommendation> {
    return this.prisma.$transaction(async (tx) => {
      // Org-scoped existence read: a cross-tenant id resolves to "not found" here,
      // before any mutation (findFirst — {id, organizationId} is not a unique key).
      const existing = await tx.pendingActionRecord.findFirst({
        where: { id: args.id, organizationId: args.orgId },
      });
      if (!existing) throw new Error(`Recommendation not found: ${args.id}`);
      const params = (existing.parameters ?? {}) as RecommendationParams;
      const updatedMeta = {
        ...(params.__recommendation ?? {}),
        note: args.note ?? null,
      };
      let updated;
      const now = new Date();
      try {
        updated = await tx.pendingActionRecord.update({
          where: { id: args.id, status: args.fromStatus, organizationId: args.orgId },
          data: {
            status: args.toStatus,
            resolvedAt: now,
            resolvedBy: args.actor.principalId,
            parameters: { ...params, __recommendation: updatedMeta } as object,
            // Spec-1B 1B-2: an operator transition TO "acted" IS an execution; stamp executedAt so
            // the outcome scorer (which gates on executedAt:{not:null} to score only executed moves)
            // keeps scoring operator-acted recs. Other transitions (dismissed/expired/...) leave
            // executedAt null — nothing executed, nothing to attribute.
            ...(args.toStatus === "acted" ? { executedAt: now } : {}),
          },
        });
      } catch (err: unknown) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2025") {
          const reread = await tx.pendingActionRecord.findFirst({
            where: { id: args.id, organizationId: args.orgId },
          });
          if (reread) throw new RecommendationStaleStatusError(rowToRecommendation(reread));
          throw new Error(`Recommendation not found: ${args.id}`);
        }
        throw err;
      }
      await tx.auditEntry.create({
        data: {
          eventType: "recommendation.act",
          actorType: args.actor.type,
          actorId: args.actor.principalId,
          entityType: "recommendation",
          entityId: args.id,
          riskCategory: existing.riskLevel,
          summary: existing.humanSummary,
          snapshot: { from: args.fromStatus, to: args.toStatus, note: args.note ?? null } as object,
          evidencePointers: [] as object,
          // Recommendation acts do not participate in the audit chain (no previousEntryHash
          // linkage). entryHash is a per-row sha256 over identifying fields plus a uuid to
          // guarantee uniqueness even for back-to-back acts on the same row.
          entryHash: buildEntryHash({
            id: args.id,
            fromStatus: args.fromStatus,
            toStatus: args.toStatus,
            principalId: args.actor.principalId,
            ts: Date.now(),
          }),
          organizationId: existing.organizationId,
        },
      });
      return rowToRecommendation(updated);
    });
  }

  /**
   * Machine-execution transition (Riley Phase-C slice 4f): marks a
   * recommendation acted AFTER the platform actually executed it (Meta write
   * accepted). The MACHINE sibling of applyAct above, deliberately mirroring
   * its tx shape with three differences: conditional updateMany instead of
   * update (a lost race returns count 0 and MUST be a benign no-op, never a
   * throw: operator acted/dismissed concurrently, lazy expiry won, or a retry
   * already transitioned); resolvedAt is the caller's execution clock (the
   * outcome-attribution anchor), not new Date(); resolvedBy is the caller's
   * machine sentinel, never a human principal. The status predicate is the
   * serialization point against applyAct, so the parameters merge cannot
   * clobber a concurrent operator write: two writers cannot both pass it.
   * The intent guard keeps this method off workflow approval rows, which
   * share the PendingActionRecord table.
   */
  async markActedByExecution(args: {
    id: string;
    organizationId: string;
    executableWorkUnitId: string;
    resolvedBy: string;
    executedAt: Date;
  }): Promise<MarkActedByExecutionResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.pendingActionRecord.findFirst({
        where: {
          id: args.id,
          organizationId: args.organizationId,
          intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        },
      });
      if (!existing) return { transitioned: false, reason: "not_found" };

      const params = (existing.parameters ?? {}) as RecommendationParams;
      const updatedMeta = {
        ...(params.__recommendation ?? {}),
        executedWorkUnitId: args.executableWorkUnitId,
      };
      const updated = await tx.pendingActionRecord.updateMany({
        where: {
          id: args.id,
          organizationId: args.organizationId,
          status: "pending",
          intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        },
        data: {
          status: "acted",
          resolvedAt: args.executedAt,
          resolvedBy: args.resolvedBy,
          // Spec-1B: promote execution truth to top-level columns (queryable + the future
          // "score only executed moves" gate, PR 1B-2). The __recommendation.executedWorkUnitId
          // JSON stash below is preserved for projectBaseCandidate, which still reads it.
          executedAt: args.executedAt,
          executionWorkUnitId: args.executableWorkUnitId,
          parameters: { ...params, __recommendation: updatedMeta } as object,
        },
      });
      if (updated.count === 0) return { transitioned: false, reason: "not_pending" };

      await tx.auditEntry.create({
        data: {
          eventType: "recommendation.act",
          actorType: "system",
          actorId: args.resolvedBy,
          entityType: "recommendation",
          entityId: args.id,
          riskCategory: existing.riskLevel,
          summary: existing.humanSummary,
          snapshot: {
            from: "pending",
            to: "acted",
            note: null,
            executableWorkUnitId: args.executableWorkUnitId,
          } as object,
          evidencePointers: [] as object,
          // ts = the EXECUTION clock, not Date.now(): this slice anchors truth
          // at execution time and the hash input must not silently depend on a
          // second wall clock (review-requested). Uniqueness is unaffected
          // (buildEntryHash salts with a random UUID), which also makes the ts
          // source non-black-box-testable; this comment is the record.
          // applyAct keeps Date.now() because its event clock IS the wall clock.
          entryHash: buildEntryHash({
            id: args.id,
            fromStatus: "pending",
            toStatus: "acted",
            principalId: args.resolvedBy,
            ts: args.executedAt.getTime(),
          }),
          organizationId: existing.organizationId,
        },
      });
      return { transitioned: true };
    });
  }

  async listPendingForAgent(args: {
    orgId: string;
    agentKey: AgentKey;
    surface: "queue";
    limit: number;
  }): Promise<{ rows: Recommendation[]; totalCount: number }> {
    // Postgres sorts text alphabetically — "high" < "low" < "medium" — which
    // would put medium ahead of high. Use a CASE expression for the intended
    // urgency ordinal. Raw SQL is fine here: it's a single read-only query.
    const orgId = args.orgId;
    const agentKey = args.agentKey;
    const surface = args.surface;
    const take = args.limit;

    // Predicate is duplicated between the raw $queryRaw (rows) and the
    // pendingActionRecord.count (totalCount). Keep these in lockstep — if
    // one path filters a row the other doesn't, totalCount would diverge
    // from rows.length in surprising ways. Filter list:
    //   organizationId / surface / status='pending' / sourceAgent /
    //   approvalRequired <> 'auto' / not yet expired
    // act.ts lazily flips status to 'expired' on write; this read-side
    // filter complements that so stale tiles don't linger.
    const where: Prisma.PendingActionRecordWhereInput = {
      organizationId: orgId,
      surface,
      status: "pending",
      sourceAgent: agentKey,
      approvalRequired: { not: "auto" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    const [rawRows, totalCount] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT
          "id", "idempotencyKey", "intent", "status", "humanSummary", "confidence",
          "riskLevel", "dollarsAtRisk", "targetEntities", "parameters",
          "approvalRequired", "sourceAgent", "sourceWorkflow", "organizationId",
          "surface", "undoableUntil", "createdAt", "expiresAt", "resolvedAt", "resolvedBy"
        FROM "PendingActionRecord"
        WHERE "organizationId" = ${orgId}
          AND "surface" = ${surface}
          AND "status" = 'pending'
          AND "sourceAgent" = ${agentKey}
          AND "approvalRequired" <> 'auto'
          AND ("expiresAt" IS NULL OR "expiresAt" > now())
        ORDER BY
          CASE "riskLevel"
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 1
            ELSE 0
          END DESC,
          "dollarsAtRisk" DESC,
          "confidence" ASC,
          "createdAt" DESC
        LIMIT ${take}
      `,
      this.prisma.pendingActionRecord.count({ where }),
    ]);

    const rows = rawRows.map((r) =>
      rowToRecommendation(r as Parameters<typeof rowToRecommendation>[0]),
    );
    return { rows, totalCount };
  }

  async latestByAgent(input: {
    orgId: string;
    agentKey: string;
    from: Date;
    to: Date;
  }): Promise<{ date: Date; humanSummary: string } | null> {
    const row = await this.prisma.pendingActionRecord.findFirst({
      where: {
        organizationId: input.orgId,
        sourceAgent: input.agentKey,
        intent: { startsWith: "recommendation." },
        createdAt: { gte: input.from, lt: input.to },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, humanSummary: true },
    });
    if (!row) return null;
    return { date: row.createdAt, humanSummary: row.humanSummary };
  }
}
