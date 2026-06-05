import type {
  PersistRecommendationInput,
  Recommendation,
  RecommendationStatus,
  RecommendationSurface,
  AgentKey,
} from "./types.js";

export interface RecommendationStore {
  /** Insert with idempotency. Returns existing row on idempotency-key collision. */
  insert(input: PersistRecommendationInput): Promise<{ row: Recommendation; idempotent: boolean }>;

  /** Loads a row by id (no org guard — caller asserts). */
  getById(id: string): Promise<Recommendation | null>;

  /** Lists rows for an org, filtered by surface + status, ordered by createdAt desc. */
  listBySurface(args: {
    orgId: string;
    surface: Exclude<RecommendationSurface, "dropped">;
    status?: RecommendationStatus;
    sinceMs?: number;
    limit?: number;
  }): Promise<Recommendation[]>;

  /**
   * Lists terminal (acted/confirmed) recommendations for a specific agent
   * within a resolvedAt time window. Used by the wins projection.
   */
  listResolvedForAgent(args: {
    orgId: string;
    agentKey: AgentKey;
    statuses: readonly RecommendationStatus[];
    resolvedSince: Date;
    limit: number;
  }): Promise<Recommendation[]>;

  /**
   * Lists non-terminal recommendations for a specific agent on a given surface.
   * Used by the Riley pipeline projection. Filter:
   *   organizationId + surface + status="pending" + sourceAgent + approvalRequired <> "auto"
   * Order:
   *   riskLevel DESC (high→medium→low via ordinal map),
   *   dollarsAtRisk DESC, confidence ASC, createdAt DESC.
   *
   * `approvalRequired <> "auto"` is a defensive filter — auto-class actions
   * don't currently land in PendingActionRecord (they execute via a different
   * path), but the producer literal layer is loose so the negative filter
   * future-proofs the read path.
   */
  listPendingForAgent(args: {
    orgId: string;
    agentKey: AgentKey;
    surface: "queue";
    limit: number;
  }): Promise<{ rows: Recommendation[]; totalCount: number }>;

  /**
   * Atomic UPDATE + AuditEntry insert. Returns the updated row. `orgId` scopes
   * the read + mutation so the store is self-isolating: a cross-tenant `id`
   * resolves to "not found" even if a caller skips its own pre-check.
   */
  applyAct(args: {
    id: string;
    orgId: string;
    actor: { principalId: string; type: "operator" };
    fromStatus: RecommendationStatus;
    toStatus: RecommendationStatus;
    note: string | undefined;
  }): Promise<Recommendation>;
}
