import type {
  RecommendationStatus,
  RecommendationSurface,
  RecommendationAction,
  RecommendationInput,
  RecommendationPresentation,
  AgentKey,
} from "@switchboard/schemas";

export type {
  RecommendationStatus,
  RecommendationSurface,
  RecommendationAction,
  RecommendationInput,
  RecommendationPresentation,
  AgentKey,
};

/**
 * Read shape returned by the store. PendingActionRecord has no `updatedAt`
 * column, so v1 omits it from the canonical Recommendation type. If a future
 * migration adds one, surface it here as `updatedAt: Date`.
 */
export interface Recommendation {
  id: string;
  orgId: string;
  agentKey: AgentKey;
  intent: string;
  action: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  surface: RecommendationSurface;
  status: RecommendationStatus;
  parameters: Record<string, unknown>;
  targetEntities: Record<string, unknown> | null;
  sourceAgent: string;
  sourceWorkflow: string | null;
  actedBy: string | null;
  actedAt: Date | null;
  note: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  undoableUntil: Date | null;
}

/**
 * Persistence write shape. Different from RecommendationInput — emit() has
 * already moved `presentation` into `parameters`, and the routing/expiry
 * fields have been computed. `presentation` is NOT a separate field here.
 */
export interface PersistRecommendationInput {
  orgId: string;
  agentKey: AgentKey;
  intent: string;
  action: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  parameters: Record<string, unknown>; // already contains presentation under __recommendation
  targetEntities: Record<string, unknown> | undefined;
  sourceWorkflow: string | undefined;
  surface: Exclude<RecommendationSurface, "dropped">;
  idempotencyKey: string;
  undoableUntil: Date | null;
  expiresAt: Date;
}

export type EmitResult =
  | { surface: "queue" | "shadow_action"; id: string; idempotent: boolean }
  | { surface: "dropped"; id: null; idempotent: false };

export type ActResult =
  | { status: "ok"; row: Recommendation }
  | { status: "already_terminal"; row: Recommendation }
  | { status: "expired"; row: Recommendation }
  | { status: "undo_window_closed"; row: Recommendation };
