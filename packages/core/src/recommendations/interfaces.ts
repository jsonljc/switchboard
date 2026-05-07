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

  /** Atomic UPDATE + AuditEntry insert. Returns the updated row. */
  applyAct(args: {
    id: string;
    actor: { principalId: string; type: "operator" };
    fromStatus: RecommendationStatus;
    toStatus: RecommendationStatus;
    note: string | undefined;
  }): Promise<Recommendation>;
}
