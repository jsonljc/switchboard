import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type {
  GovernanceVerdictStore,
  SaveGovernanceVerdictInput,
} from "../../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../../governance/posture-cache.js";
import type { HandoffStore } from "../../handoff/types.js";
import { buildHandoffPackage } from "../../handoff/build-handoff-package.js";
import { resolveGovernanceMode } from "@switchboard/schemas";
import type { GovernanceVerdictReason } from "@switchboard/schemas";
import { findUnsubstantiatedPriceClaims } from "../../governance/price-gate/price-claim-scanner.js";
import type { ConversationStatusSetter } from "./deterministic-safety-gate.js";

// ---------------------------------------------------------------------------
// PriceClaimGateHook (P1-D)
//
// Deterministic, pre-output gate: a conversational price must originate from an
// operator-approved service price (the playbook's services[].price). When the
// reply states a currency-marked amount the operator never approved — or when
// the org has NO approved prices at all (fail-closed) — the gate blocks in
// enforce mode and routes the conversation to a human, exactly like the
// banned-phrase gate. There was previously NO deterministic guard on a wrong /
// invented price (the claim classifier has no price type; only SKILL.md prose
// constrained it).
//
// Runs as afterSkill BEFORE TracePersistenceHook so a blocked price is never
// persisted. Shares the master deterministic governance mode (resolveGovernanceMode)
// with the banned-phrase gate. Failure-mode discipline mirrors the sibling gates:
// a verdict/handoff/status persistence error is logged but never skips the block.
// ---------------------------------------------------------------------------

export interface PriceClaimGateHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  /**
   * The org's operator-approved service prices (major units). Empty when the org
   * has no priced playbook services — which makes the gate fail closed (any price
   * claim is unsubstantiated). Wired from the same playbook source as booking value.
   */
  getApprovedPrices: (orgId: string) => Promise<readonly number[]>;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  postureCache: GovernancePostureCache;
  clock: () => Date;
  renderHandoff: (input: {
    jurisdiction: "SG" | "MY";
    reasonCode: GovernanceVerdictReason;
  }) => string;
}

export class PriceClaimGateHook implements SkillHook {
  readonly name = "price-claim-gate";

  constructor(private readonly deps: PriceClaimGateHookDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const resolution = await this.deps.governanceConfigResolver(ctx.deploymentId);

    if (resolution.status === "missing") return;

    if (resolution.status === "error") {
      const cached = this.deps.postureCache.lastKnown(ctx.deploymentId);
      if (cached?.mode === "enforce") {
        // Resolver down but last-known posture was enforce → fail closed: block any
        // unsubstantiated price, attributing the block to governance unavailability.
        await this.evaluateAndApply(ctx, result, {
          mode: "enforce",
          jurisdiction: cached.jurisdiction,
          clinicType: cached.clinicType,
          reasonCode: "governance_unavailable",
        });
        return;
      }
      console.error(
        `[price-claim-gate] resolver error for "${ctx.deploymentId}" — failing open (no cached enforce posture):`,
        resolution.error,
      );
      return;
    }

    const { config } = resolution;
    const mode = resolveGovernanceMode(config);
    const jurisdiction = config.jurisdiction;
    const clinicType = config.clinicType;

    this.deps.postureCache.remember(ctx.deploymentId, { mode, jurisdiction, clinicType });

    if (mode === "off") return;

    await this.evaluateAndApply(ctx, result, {
      mode,
      jurisdiction,
      clinicType,
      reasonCode: "unsubstantiated_price",
    });
  }

  /**
   * Scan the reply for unsubstantiated prices and apply the verdict for `mode`.
   * enforce → block (replace output + handoff + status flip); observe → verdict only.
   */
  private async evaluateAndApply(
    ctx: SkillHookContext,
    result: SkillExecutionResult,
    posture: {
      mode: "observe" | "enforce";
      jurisdiction: "SG" | "MY";
      clinicType: "medical" | "nonMedical";
      reasonCode: GovernanceVerdictReason;
    },
  ): Promise<void> {
    const approvedPrices = await this.deps.getApprovedPrices(ctx.orgId);
    const unsubstantiated = findUnsubstantiatedPriceClaims(result.response, approvedPrices);
    if (unsubstantiated.length === 0) return; // No price, or every price is approved.

    const { mode, jurisdiction, clinicType, reasonCode } = posture;
    const verdictInput: SaveGovernanceVerdictInput = {
      action: mode === "enforce" ? "block" : "allow",
      reasonCode,
      jurisdiction,
      clinicType,
      sourceGuard: "price_gate",
      originalText: result.response,
      auditLevel: mode === "enforce" ? "critical" : "warning",
      decidedAt: this.deps.clock().toISOString(),
      conversationId: ctx.sessionId,
      deploymentId: ctx.deploymentId,
      details: {
        unsubstantiatedPrices: unsubstantiated.map((c) => c.raw),
        approvedPriceCount: approvedPrices.length,
      },
    };

    try {
      await this.deps.verdictStore.save(verdictInput);
    } catch (err) {
      console.error(`[price-claim-gate] verdictStore.save failed (verdict still applied):`, err);
    }

    if (mode === "observe") return; // Telemetry only — output unchanged.

    const handoffText = this.deps.renderHandoff({ jurisdiction, reasonCode });

    try {
      await this.deps.conversationStore.setConversationStatus(ctx.sessionId, "human_override");
    } catch (err) {
      console.error(`[price-claim-gate] setConversationStatus failed (block still applied):`, err);
    }

    try {
      await this.deps.handoffStore.save(
        buildHandoffPackage(ctx.sessionId, ctx.orgId, result.trace.turnCount, this.deps.clock),
      );
    } catch (err) {
      console.error(`[price-claim-gate] handoffStore.save failed (block still applied):`, err);
    }

    // In-place mutation so downstream hooks (e.g. TracePersistenceHook) see the handoff text.
    result.response = handoffText;
  }
}
