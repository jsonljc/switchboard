import { createHash } from "node:crypto";
import { RecommendationInputSchema } from "@switchboard/schemas";
import { routeRecommendation } from "./router.js";
import { buildRileyEmissionWorkTrace } from "./emission-mirror.js";
import type { RecommendationStore } from "./interfaces.js";
import type { RecommendationEmissionMirror } from "./emission-mirror.js";
import type { PersistRecommendationInput, RecommendationInput, EmitResult } from "./types.js";

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

export interface EmitRecommendationOptions {
  /**
   * When provided, every emission performs an atomic dual-write of the
   * Recommendation row + a WorkTrace mirror row. When absent, only the
   * Recommendation row is written (back-compat for callers that have not yet
   * adopted the mirror).
   */
  mirror?: RecommendationEmissionMirror;
  /**
   * Cron identifier captured into the mirrored WorkTrace's parameters.cronId
   * field. Required when `mirror` is provided so the WorkTrace records its
   * emission origin. Ignored when `mirror` is absent.
   */
  cronId?: string;
  /**
   * Deployment id captured into the mirrored WorkTrace's `deploymentId` field.
   * Optional; populated from the cron loop in production so per-deployment
   * outcome attribution (Wave B PR-3) can join WorkTrace → Deployment without
   * scanning audit logs. When absent, `WorkTrace.deploymentId` is unset and
   * downstream readers must look up by orgId.
   */
  deploymentId?: string;
  /**
   * Clock injection point. Defaults to `() => new Date()`.
   */
  now?: () => Date;
}

export async function emitRecommendation(
  store: RecommendationStore,
  input: RecommendationInput,
  options: EmitRecommendationOptions = {},
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

  const nowFn = options.now ?? (() => new Date());
  const now = nowFn();
  const idempotencyKey = computeIdempotencyKey(validated, now);
  const expiresAt = validated.expiresAt ?? new Date(now.getTime() + ONE_DAY_MS);
  const undoableUntil = surface === "shadow_action" ? new Date(now.getTime() + ONE_DAY_MS) : null;

  // Strip `presentation` and the four risk-contract booleans from the spread — they
  // live inside parameters.__recommendation so they survive the JSONB round-trip without
  // a DB migration. `action` is stashed alongside them so the read-back can reconstruct
  // the domain action without adding a column.
  const {
    presentation,
    parameters: rawParameters,
    externalEffect,
    financialEffect,
    clientFacing,
    requiresConfirmation,
    ...rest
  } = validated;
  const parameters: Record<string, unknown> = {
    ...rawParameters,
    __recommendation: {
      action: validated.action,
      presentation,
      riskContract: {
        riskLevel: validated.riskLevel,
        externalEffect,
        financialEffect,
        clientFacing,
        requiresConfirmation,
      },
    },
  };

  const persistInput: PersistRecommendationInput = {
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
  };

  if (options.mirror) {
    if (!options.cronId) {
      throw new Error(
        "emitRecommendation: options.cronId is required when options.mirror is provided",
      );
    }
    const workTrace = buildRileyEmissionWorkTrace({
      insert: persistInput,
      now,
      cronId: options.cronId,
      ...(options.deploymentId ? { deploymentId: options.deploymentId } : {}),
    });
    const { row, idempotent } = await options.mirror.recordEmission({
      recommendationInsert: persistInput,
      workTrace,
    });
    return { surface, id: row.id, idempotent };
  }

  // Back-compat path: single-store insert, no WorkTrace mirror.
  const { row, idempotent } = await store.insert(persistInput);
  return { surface, id: row.id, idempotent };
}
