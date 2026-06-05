import { parseMiraComposeOutput } from "@switchboard/schemas";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { SynthesizedCreativeBrief } from "./creative-brief-synthesis.js";
import type { MiraBriefComposeSubmitInput } from "./mira-self-brief-request.js";

export interface HandoffBriefCandidate {
  organizationId: string;
  recommendationId: string;
  actionType: string;
  campaignId: string;
  rationale: string;
  evidence: { clicks: number; conversions: number; days: number };
}

export interface ResolveHandoffBriefDeps {
  candidate: HandoffBriefCandidate;
  /** MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED === "true", read per call. */
  readFlag: () => boolean;
  /** The shipped BusinessFacts synthesis (the fallback on EVERY degrade path). */
  synthesize: () => Promise<SynthesizedCreativeBrief>;
  /**
   * The PR-3 compose closure WITHOUT a pre-resolved deployment: the closure
   * resolves the org's CREATIVE deployment by intent prefix itself. The
   * candidate's own deploymentId is RILEY's ad-optimizer deployment and must
   * never ride the compose targetHint.
   */
  submitCompose: (input: MiraBriefComposeSubmitInput) => Promise<SubmitWorkResponse>;
  warn: (msg: string) => void;
}

/**
 * Slice-4 spec 3.8: compose BEFORE the mandatory-approval park, so the brief
 * the human approves IS the brief the post-approval handler dispatches
 * (binding-hash integrity). The handoff path is NEVER blocked by the brain:
 * every degrade path (flag off, abstain, parse failure, ingress error, parked
 * compose, failed outcome, thrown submit) returns the shipped synthesized
 * brief, byte-identical to pre-slice-4 behavior.
 */
export async function resolveHandoffBrief(
  deps: ResolveHandoffBriefDeps,
): Promise<SynthesizedCreativeBrief> {
  if (!deps.readFlag()) return deps.synthesize();

  const c = deps.candidate;
  try {
    const response = await deps.submitCompose({
      organizationId: c.organizationId,
      composeSource: "riley_handoff",
      recommendation: {
        actionType: c.actionType,
        campaignId: c.campaignId,
        rationale: c.rationale,
        evidence: c.evidence,
      },
      // Deterministic per recommendation+action: a retried audit run replays
      // the claimed compose instead of paying a second LLM call.
      idempotencyKey: `handoff-compose:${c.recommendationId}:${c.actionType}`,
      trigger: "internal",
    });

    if (!response.ok) {
      deps.warn(
        `[handoff-enrichment] compose failed for rec=${c.recommendationId}: ${response.error.type}; using synthesized brief`,
      );
      return deps.synthesize();
    }
    if ("approvalRequired" in response && response.approvalRequired) {
      deps.warn(
        `[handoff-enrichment] compose parked for rec=${c.recommendationId}; using synthesized brief`,
      );
      return deps.synthesize();
    }
    if (response.result.outcome !== "completed") {
      deps.warn(
        `[handoff-enrichment] compose outcome ${response.result.outcome} for rec=${c.recommendationId}; using synthesized brief`,
      );
      return deps.synthesize();
    }
    const text = (response.result.outputs as { response?: unknown }).response;
    const parsed =
      typeof text === "string"
        ? parseMiraComposeOutput(text)
        : ({ ok: false, error: "no response output" } as const);
    if (!parsed.ok) {
      deps.warn(
        `[handoff-enrichment] compose parse failure for rec=${c.recommendationId}: ${parsed.error}; using synthesized brief`,
      );
      return deps.synthesize();
    }
    if (parsed.value.decision === "abstain") {
      deps.warn(
        `[handoff-enrichment] brain abstained for rec=${c.recommendationId} (${parsed.value.reason}); using synthesized brief`,
      );
      return deps.synthesize();
    }
    return {
      productDescription: parsed.value.brief!.productDescription,
      targetAudience: parsed.value.brief!.targetAudience,
    };
  } catch (err) {
    deps.warn(
      `[handoff-enrichment] compose threw for rec=${c.recommendationId}: ${String(err)}; using synthesized brief`,
    );
    return deps.synthesize();
  }
}
