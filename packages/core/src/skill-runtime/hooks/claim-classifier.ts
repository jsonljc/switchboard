import type { GovernanceVerdict, GovernanceVerdictReason } from "@switchboard/schemas";
import { resolveClaimClassifierConfig, type ClaimType } from "@switchboard/schemas";
import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { AnthropicClaimClassifier } from "../../governance/classifier/anthropic-classifier.js";
import type { SubstantiationResolver } from "../../governance/classifier/substantiation-resolver.js";
import type { RewriteTemplateEntry } from "../../governance/classifier/rewrite-templates/index.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/index.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { GovernancePostureCache } from "../../governance/posture-cache.js";
import type { HandoffStore } from "../../handoff/types.js";
import { buildHandoffPackage } from "../../handoff/build-handoff-package.js";
import type { ConversationStatusSetter } from "./deterministic-safety-gate.js";
import {
  runClassifier,
  type ClassifierOutcome,
} from "../../governance/classifier/run-classifier.js";

export interface ClaimClassifierHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: GovernancePostureCache;
  classifier: AnthropicClaimClassifier;
  substantiationResolver: SubstantiationResolver;
  rewriteLoader: (j: "SG" | "MY") => readonly RewriteTemplateEntry[];
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  splitSentences: (text: string) => readonly string[];
  clock: () => Date;
  renderHandoff: (input: {
    jurisdiction: "SG" | "MY";
    reasonCode: GovernanceVerdictReason;
  }) => string;
}

type SentenceAction =
  | { kind: "allow" }
  | {
      kind: "rewrite";
      originalSentence: string;
      replacement: string;
      reasonCode: GovernanceVerdictReason;
      details: Record<string, unknown>;
    }
  | {
      kind: "escalate";
      originalSentence: string;
      reasonCode: GovernanceVerdictReason;
      details: Record<string, unknown>;
    };

const REWRITEABLE: ReadonlyArray<ClaimType> = [
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
];
const ESCALATE_ONLY: ReadonlyArray<ClaimType> = ["testimonial", "medical-advice", "diagnosis"];

export class ClaimClassifierHook implements SkillHook {
  readonly name = "claim-classifier";

  constructor(private readonly deps: ClaimClassifierHookDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const resolution = await this.deps.governanceConfigResolver(ctx.deploymentId);

    if (resolution.status === "missing") return;
    if (resolution.status === "error") {
      const cached = this.deps.postureCache.lastKnown(ctx.deploymentId);
      if (cached?.mode === "enforce") {
        await this.failClosed(ctx, result, cached.jurisdiction, cached.clinicType);
        return;
      }
      console.error(
        "[claim-classifier] resolver error and posture cache miss/observe/off → fail open",
        resolution.error,
      );
      return;
    }

    const config = resolution.config;
    const classifierConfig = resolveClaimClassifierConfig(config);
    if (classifierConfig.mode === "off") return;

    const jurisdiction = (config as unknown as { jurisdiction: "SG" | "MY" }).jurisdiction;
    const clinicType = (config as unknown as { clinicType: "medical" | "nonMedical" }).clinicType;

    this.deps.postureCache.remember(ctx.deploymentId, {
      mode: classifierConfig.mode,
      jurisdiction,
      clinicType,
    });

    const sentences = this.deps.splitSentences(result.response);
    if (sentences.length === 0) return;

    const outcomes = await runClassifier({
      sentences,
      model: classifierConfig.model,
      latencyBudgetMs: classifierConfig.latencyBudgetMs,
      classifier: this.deps.classifier,
    });

    const actions: SentenceAction[] = [];
    // outcomes[i] and sentences[i] are always defined — both arrays have the same
    // length by construction (runClassifier maps 1:1 over input.sentences).
    for (let i = 0; i < outcomes.length; i++) {
      actions.push(
        await this.decideAction({
          outcome: outcomes[i] as ClassifierOutcome,
          sentence: sentences[i] as string,
          jurisdiction,
          deploymentId: ctx.deploymentId,
          latencyBudgetMs: classifierConfig.latencyBudgetMs,
        }),
      );
    }

    const hasEscalate = actions.some((a) => a.kind === "escalate");
    const hasRewrite = actions.some((a) => a.kind === "rewrite");

    if (hasEscalate) {
      await this.applyEscalate({
        ctx,
        result,
        actions,
        jurisdiction,
        clinicType,
        mode: classifierConfig.mode,
      });
      return;
    }

    if (hasRewrite) {
      await this.applyRewrites({
        ctx,
        result,
        actions,
        jurisdiction,
        clinicType,
        mode: classifierConfig.mode,
      });
      return;
    }
  }

  private async decideAction(args: {
    outcome: ClassifierOutcome;
    sentence: string;
    jurisdiction: "SG" | "MY";
    deploymentId: string;
    latencyBudgetMs: number;
  }): Promise<SentenceAction> {
    const { outcome, sentence, jurisdiction, deploymentId, latencyBudgetMs } = args;

    if (outcome.status === "timeout") {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode: "classifier_timeout",
        details: {
          originalSentence: sentence,
          errorKind: "timeout",
          latencyBudgetMs,
          schemaVersion: "1.0.0",
        },
      };
    }

    if (outcome.status === "error") {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode: "classifier_error",
        details: {
          originalSentence: sentence,
          errorKind: "api_error",
          latencyBudgetMs,
          schemaVersion: "1.0.0",
          errorMessage: outcome.error.message.slice(0, 200),
        },
      };
    }

    const { result, promptVersion, promptHash, schemaVersion, model } = outcome.result;
    const baseDetails: Record<string, unknown> = {
      promptVersion,
      promptHash,
      schemaVersion,
      model,
      claimType: result.claimType,
      confidence: result.confidence,
      originalSentence: sentence,
    };

    if (result.claimType === "none") return { kind: "allow" };

    if (ESCALATE_ONLY.includes(result.claimType)) {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode: "unsupported_claim_escalated",
        details: baseDetails,
      };
    }

    const substResolution = await this.deps.substantiationResolver.resolve({
      sentence,
      claimType: result.claimType,
      jurisdiction,
      deploymentId,
    });

    if (substResolution.status === "matched") return { kind: "allow" };

    const detailsWithSource = {
      ...baseDetails,
      matchedSourceId: substResolution.sourceId,
      matchedSourceType: substResolution.sourceType,
      matchedText: substResolution.matchedText,
    };

    if (result.claimType === "credentials") {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode:
          substResolution.status === "stale"
            ? "claim_substantiation_stale"
            : "unsupported_claim_escalated",
        details: detailsWithSource,
      };
    }

    if (REWRITEABLE.includes(result.claimType)) {
      const template = this.deps
        .rewriteLoader(jurisdiction)
        .find((t) => t.claimType === result.claimType);
      if (!template) {
        console.error(
          `[claim-classifier] no rewrite template for (${result.claimType}, ${jurisdiction}) — escalating`,
        );
        return {
          kind: "escalate",
          originalSentence: sentence,
          reasonCode: "unsupported_claim_escalated",
          details: detailsWithSource,
        };
      }
      return {
        kind: "rewrite",
        originalSentence: sentence,
        replacement: template.template,
        reasonCode:
          substResolution.status === "stale"
            ? "claim_substantiation_stale"
            : "unsupported_claim_rewritten",
        details: { ...detailsWithSource, rewrittenSentence: template.template },
      };
    }

    // Unreachable; defensive.
    return {
      kind: "escalate",
      originalSentence: sentence,
      reasonCode: "unsupported_claim_escalated",
      details: detailsWithSource,
    };
  }

  private async failClosed(
    ctx: SkillHookContext,
    result: SkillExecutionResult,
    jurisdiction: "SG" | "MY",
    clinicType: "medical" | "nonMedical",
  ): Promise<void> {
    const handoff = this.deps.renderHandoff({ jurisdiction, reasonCode: "governance_unavailable" });
    const originalText = result.response;

    const verdict: GovernanceVerdict = {
      action: "block",
      reasonCode: "governance_unavailable",
      jurisdiction,
      clinicType,
      sourceGuard: "claim_classifier",
      originalText,
      emittedText: handoff,
      auditLevel: "critical",
      decidedAt: this.deps.clock().toISOString(),
      conversationId: ctx.sessionId,
    };
    try {
      await this.deps.verdictStore.save({ ...verdict, deploymentId: ctx.deploymentId });
    } catch (err) {
      console.error("[claim-classifier] verdictStore.save threw on fail-closed", err);
    }
    try {
      await this.deps.handoffStore.save(
        buildHandoffPackage(ctx.sessionId, ctx.orgId, result.trace.turnCount, this.deps.clock),
      );
    } catch (err) {
      console.error("[claim-classifier] handoffStore.save threw on fail-closed", err);
    }
    await this.deps.conversationStore.setConversationStatus(ctx.sessionId, "human_override");
    result.response = handoff;
  }

  private async applyEscalate(args: {
    ctx: SkillHookContext;
    result: SkillExecutionResult;
    actions: ReadonlyArray<SentenceAction>;
    jurisdiction: "SG" | "MY";
    clinicType: "medical" | "nonMedical";
    mode: "off" | "observe" | "enforce";
  }): Promise<void> {
    const { ctx, result, actions, jurisdiction, clinicType, mode } = args;
    const decidedAt = this.deps.clock().toISOString();
    const handoff = this.deps.renderHandoff({
      jurisdiction,
      reasonCode: "unsupported_claim_escalated",
    });

    for (const a of actions) {
      if (a.kind !== "escalate") continue;
      const verdict: GovernanceVerdict = {
        action: mode === "observe" ? "allow" : "escalate",
        reasonCode: a.reasonCode,
        jurisdiction,
        clinicType,
        sourceGuard: "claim_classifier",
        originalText: a.originalSentence,
        emittedText: mode === "observe" ? a.originalSentence : handoff,
        auditLevel: mode === "observe" ? "warning" : "critical",
        decidedAt,
        conversationId: ctx.sessionId,
      };
      try {
        const saveInput = { ...verdict, deploymentId: ctx.deploymentId, details: a.details };
        await this.deps.verdictStore.save(saveInput);
      } catch (err) {
        console.error("[claim-classifier] verdictStore.save threw on escalate", err);
      }
    }

    if (mode === "observe") return;

    try {
      await this.deps.handoffStore.save(
        buildHandoffPackage(ctx.sessionId, ctx.orgId, result.trace.turnCount, this.deps.clock),
      );
    } catch (err) {
      console.error("[claim-classifier] handoffStore.save threw on escalate", err);
    }
    await this.deps.conversationStore.setConversationStatus(ctx.sessionId, "human_override");
    result.response = handoff;
  }

  private async applyRewrites(args: {
    ctx: SkillHookContext;
    result: SkillExecutionResult;
    actions: ReadonlyArray<SentenceAction>;
    jurisdiction: "SG" | "MY";
    clinicType: "medical" | "nonMedical";
    mode: "off" | "observe" | "enforce";
  }): Promise<void> {
    const { ctx, result, actions, jurisdiction, clinicType, mode } = args;
    const decidedAt = this.deps.clock().toISOString();

    for (const a of actions) {
      if (a.kind !== "rewrite") continue;
      const verdict: GovernanceVerdict = {
        action: mode === "observe" ? "allow" : "rewrite",
        reasonCode: a.reasonCode,
        jurisdiction,
        clinicType,
        sourceGuard: "claim_classifier",
        originalText: a.originalSentence,
        emittedText: a.replacement,
        auditLevel: mode === "observe" ? "warning" : "critical",
        decidedAt,
        conversationId: ctx.sessionId,
      };
      try {
        const saveInput = { ...verdict, deploymentId: ctx.deploymentId, details: a.details };
        await this.deps.verdictStore.save(saveInput);
      } catch (err) {
        console.error("[claim-classifier] verdictStore.save threw on rewrite", err);
      }
    }

    if (mode === "observe") return;

    // Splice replacements into result.response in original-occurrence order.
    let response = result.response;
    for (const a of actions) {
      if (a.kind !== "rewrite") continue;
      response = response.replace(a.originalSentence, a.replacement);
    }
    result.response = response;
  }
}
