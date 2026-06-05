import type { RecommendationStore } from "./interfaces.js";
import type {
  ActResult,
  Recommendation,
  RecommendationAction,
  RecommendationStatus,
} from "./types.js";

export class RecommendationStaleStatusError extends Error {
  constructor(public readonly row: import("./types.js").Recommendation) {
    super("recommendation status changed under us");
    this.name = "RecommendationStaleStatusError";
  }
}

export interface ActOnRecommendationInput {
  recommendationId: string;
  orgId: string;
  actor: { principalId: string; type: "operator" };
  action: RecommendationAction;
  note?: string;
}

const QUEUE_ACTIONS = new Set<RecommendationAction>(["primary", "secondary", "dismiss"]);
const SHADOW_ACTIONS = new Set<RecommendationAction>(["confirm", "undo"]);
const TERMINAL_STATUSES = new Set<RecommendationStatus>([
  "acted",
  "dismissed",
  "confirmed",
  "dismissed_by_undo",
  "expired",
]);

function nextStatus(action: RecommendationAction): RecommendationStatus {
  switch (action) {
    case "primary":
    case "secondary":
      return "acted";
    case "dismiss":
      return "dismissed";
    case "confirm":
      return "confirmed";
    case "undo":
      return "dismissed_by_undo";
  }
}

export async function actOnRecommendation(
  store: RecommendationStore,
  input: ActOnRecommendationInput,
): Promise<ActResult> {
  const row = await store.getById(input.recommendationId);
  if (!row) throw new Error(`Recommendation not found: ${input.recommendationId}`);
  if (row.orgId !== input.orgId) throw new Error("org mismatch");

  // Surface-action validity.
  if (row.surface === "queue" && !QUEUE_ACTIONS.has(input.action)) {
    throw new Error(`queue surface accepts primary|secondary|dismiss, got ${input.action}`);
  }
  if (row.surface === "shadow_action" && !SHADOW_ACTIONS.has(input.action)) {
    throw new Error(`shadow surface accepts confirm|undo, got ${input.action}`);
  }

  // Lazy expiry.
  if (row.status === "pending" && row.expiresAt && row.expiresAt < new Date()) {
    try {
      const expired: Recommendation = await store.applyAct({
        id: row.id,
        orgId: input.orgId,
        actor: input.actor,
        fromStatus: "pending",
        toStatus: "expired",
        note: undefined,
      });
      return { status: "expired", row: expired };
    } catch (err) {
      if (err instanceof RecommendationStaleStatusError) {
        return { status: "expired", row: err.row };
      }
      throw err;
    }
  }

  // Terminal-state guard.
  if (TERMINAL_STATUSES.has(row.status)) {
    return { status: "already_terminal", row };
  }

  // Undo-window guard (shadow only).
  if (input.action === "undo" && row.undoableUntil && row.undoableUntil < new Date()) {
    return { status: "undo_window_closed", row };
  }

  try {
    const updated: Recommendation = await store.applyAct({
      id: row.id,
      orgId: input.orgId,
      actor: input.actor,
      fromStatus: row.status,
      toStatus: nextStatus(input.action),
      note: input.note,
    });
    return { status: "ok", row: updated };
  } catch (err) {
    if (err instanceof RecommendationStaleStatusError) {
      return { status: "already_terminal", row: err.row };
    }
    throw err;
  }
}
