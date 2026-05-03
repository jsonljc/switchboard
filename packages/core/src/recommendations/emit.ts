import { createHash } from "node:crypto";
import { RecommendationInputSchema } from "@switchboard/schemas";
import { routeRecommendation } from "./router.js";
import type { RecommendationStore } from "./interfaces.js";
import type { RecommendationInput, EmitResult } from "./types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function dayBucket(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function computeIdempotencyKey(input: RecommendationInput, now: Date): string {
  const targets = input.targetEntities ?? {};
  const targetSig = Object.keys(targets)
    .sort()
    .map((k) => `${k}=${String((targets as Record<string, unknown>)[k])}`)
    .join("|");
  const raw = [input.orgId, input.intent, targetSig, dayBucket(now)].join("::");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function emitRecommendation(
  store: RecommendationStore,
  input: RecommendationInput,
): Promise<EmitResult> {
  // Validate.
  const validated = RecommendationInputSchema.parse(input);

  // Route.
  const surface = routeRecommendation({
    confidence: validated.confidence,
    dollarsAtRisk: validated.dollarsAtRisk,
    action: validated.action,
  });

  if (surface === "dropped") {
    return { surface: "dropped", id: null, idempotent: false };
  }

  const now = new Date();
  const idempotencyKey = computeIdempotencyKey(validated, now);
  const expiresAt = validated.expiresAt ?? new Date(now.getTime() + ONE_DAY_MS);
  const undoableUntil = surface === "shadow_action" ? new Date(now.getTime() + ONE_DAY_MS) : null;

  // Strip `presentation` from the spread — it lives inside parameters.__recommendation.
  // Stash `action` alongside it so the read-back can reconstruct the domain action
  // without adding a column.
  const { presentation, parameters: rawParameters, ...rest } = validated;
  const parameters: Record<string, unknown> = {
    ...rawParameters,
    __recommendation: {
      action: validated.action,
      presentation,
    },
  };

  const { row, idempotent } = await store.insert({
    orgId: rest.orgId,
    agentKey: rest.agentKey,
    intent: rest.intent,
    action: rest.action,
    humanSummary: rest.humanSummary,
    confidence: rest.confidence,
    dollarsAtRisk: rest.dollarsAtRisk,
    riskLevel: rest.riskLevel,
    parameters,
    targetEntities: rest.targetEntities,
    sourceWorkflow: rest.sourceWorkflow,
    surface,
    idempotencyKey,
    undoableUntil,
    expiresAt,
  });

  return { surface, id: row.id, idempotent };
}
