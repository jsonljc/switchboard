import { RecommendationStaleStatusError } from "./act.js";
import type { RecommendationStore } from "./interfaces.js";
import type { PersistRecommendationInput, Recommendation } from "./types.js";

export function createInMemoryRecommendationStore(): RecommendationStore & {
  rows: Recommendation[];
  byKey: Map<string, Recommendation>;
} {
  const rows: Recommendation[] = [];
  const byKey = new Map<string, Recommendation>();

  return {
    rows,
    byKey,
    async insert(input: PersistRecommendationInput) {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { row: existing, idempotent: true };
      const now = new Date();
      const row: Recommendation = {
        id: `rec-${rows.length + 1}`,
        orgId: input.orgId,
        agentKey: input.agentKey,
        intent: input.intent,
        action: input.action,
        humanSummary: input.humanSummary,
        confidence: input.confidence,
        dollarsAtRisk: input.dollarsAtRisk,
        riskLevel: input.riskLevel,
        surface: input.surface,
        status: "pending",
        parameters: input.parameters,
        targetEntities: input.targetEntities ?? null,
        sourceAgent: input.agentKey,
        sourceWorkflow: input.sourceWorkflow ?? null,
        actedBy: null,
        actedAt: null,
        note: null,
        createdAt: now,
        expiresAt: input.expiresAt,
        undoableUntil: input.undoableUntil,
      };
      rows.push(row);
      byKey.set(input.idempotencyKey, row);
      return { row, idempotent: false };
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listBySurface({ orgId, surface, status, sinceMs, limit }) {
      const cutoff = sinceMs ? new Date(Date.now() - sinceMs) : null;
      const filtered = rows.filter(
        (r) =>
          r.orgId === orgId &&
          r.surface === surface &&
          (status ? r.status === status : true) &&
          (cutoff ? r.createdAt >= cutoff : true),
      );
      // Order by createdAt desc to match the interface contract.
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
    },
    async listResolvedForAgent({ orgId, agentKey, statuses, resolvedSince, limit }) {
      const filtered = rows
        .filter(
          (r) =>
            r.orgId === orgId &&
            r.agentKey === agentKey &&
            statuses.includes(r.status) &&
            r.actedAt !== null &&
            r.actedAt >= resolvedSince,
        )
        .sort((a, b) => (b.actedAt?.getTime() ?? 0) - (a.actedAt?.getTime() ?? 0));
      return filtered.slice(0, Math.max(0, Math.min(limit, 200)));
    },
    async listPendingForAgent({ orgId, agentKey, surface, limit }) {
      const RISK_ORDINAL = { high: 3, medium: 2, low: 1 } as const;
      const filtered = rows.filter(
        (r) =>
          r.orgId === orgId &&
          r.sourceAgent === agentKey &&
          r.surface === surface &&
          r.status === "pending",
        // approvalRequired isn't on the in-memory Recommendation shape;
        // tests that need to assert the auto-exclusion rely on the SQL contract
        // covered by the prisma-recommendation-store test.
      );
      filtered.sort((a, b) => {
        const ar = RISK_ORDINAL[a.riskLevel];
        const br = RISK_ORDINAL[b.riskLevel];
        if (ar !== br) return br - ar;
        if (a.dollarsAtRisk !== b.dollarsAtRisk) return b.dollarsAtRisk - a.dollarsAtRisk;
        // confidence ASC (low promoted)
        if (a.confidence !== b.confidence) return a.confidence - b.confidence;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      const sliced = filtered.slice(0, Math.max(0, limit));
      return { rows: sliced, totalCount: filtered.length };
    },
    async applyAct({ id, actor, fromStatus, toStatus, note }) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("not found");
      if (row.status !== fromStatus) throw new RecommendationStaleStatusError(row);
      row.status = toStatus;
      row.actedBy = actor.principalId;
      row.actedAt = new Date();
      row.note = note ?? null;
      return row;
    },
  };
}
