import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type {
  MiraComposeBrief,
  MiraComposeRecommendation,
  MiraComposeSource,
} from "@switchboard/schemas";

/**
 * ISO 8601 week key (UTC), e.g. "2026-W24". The self-brief cadence needs
 * uniqueness per week, not org-local calendar semantics (slice-4 spec 3.7),
 * so UTC. ISO rule: the Thursday of the current week decides the week-year.
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface MiraBriefComposeSubmitInput {
  organizationId: string;
  composeSource: MiraComposeSource;
  recommendation?: MiraComposeRecommendation;
  idempotencyKey: string;
  /** Defaults to "schedule" (the weekly scan); the handoff path passes "internal". */
  trigger?: "schedule" | "internal";
}

/**
 * Canonical submit for the slice-4 brain compose. Cron-initiated work is a
 * TRACE ROOT and carries the seeded system principal VERBATIM (a bespoke
 * system:<x> id has no IdentitySpec and hard-denies). The deployment comes
 * from the caller's resolve (resolveDeploymentForIntent or the worker's own
 * floor resolve); the intent prefix would derive the same "creative" slug,
 * but explicit beats derived for a cron.
 */
export function buildMiraBriefComposeSubmitRequest(
  input: MiraBriefComposeSubmitInput,
  deployment: { deploymentId: string; skillSlug: string },
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: "creative.brief.compose",
    parameters: {
      composeSource: input.composeSource,
      ...(input.recommendation ? { recommendation: input.recommendation } : {}),
    },
    trigger: input.trigger ?? "schedule",
    surface: { surface: "api" },
    idempotencyKey: input.idempotencyKey,
    targetHint: { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug },
  };
}

export interface MiraConceptDraftSubmitInput {
  organizationId: string;
  brief: MiraComposeBrief;
  parentWorkUnitId: string;
  idempotencyKey: string;
}

/**
 * Draft-only concept child: the same intent Alex's delegate tool and the
 * Riley handoff handler submit (system_auto_approved, no spend, no pipeline
 * fire). Minimal brief payload: the workflow defaults platforms/images/
 * references itself. parentWorkUnitId links the draft to its compose trace.
 */
export function buildMiraConceptDraftSubmitRequest(
  input: MiraConceptDraftSubmitInput,
  deployment: { deploymentId: string; skillSlug: string },
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: "creative.concept.draft",
    parameters: {
      brief: {
        productDescription: input.brief.productDescription,
        targetAudience: input.brief.targetAudience,
      },
    },
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: input.idempotencyKey,
    parentWorkUnitId: input.parentWorkUnitId,
    targetHint: { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug },
  };
}
