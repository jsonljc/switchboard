import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { BannedPhraseEntry } from "../../governance/banned-phrases/types.js";
import { REASON_CODE_BY_CATEGORY } from "../../governance/banned-phrases/types.js";
import { scanForBannedPhrases } from "../../governance/scanner/banned-phrase-scanner.js";
import { renderHandoffTemplate } from "../../governance/handoff-template.js";
import type {
  GovernanceVerdictStore,
  SaveGovernanceVerdictInput,
} from "../../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../../governance/posture-cache.js";
import type { HandoffStore } from "../../handoff/types.js";
import { buildHandoffPackage } from "../../handoff/build-handoff-package.js";
import { resolveGovernanceMode } from "@switchboard/schemas";
import type { ConversationStatusUpsertContext } from "../../channel-gateway/conversation-status-types.js";

// Re-export so callers can import from one place.
export type { ConversationStatusUpsertContext };

// ---------------------------------------------------------------------------
// Dep interface — narrow slice of conversation state we actually need
// ---------------------------------------------------------------------------

/**
 * Minimal interface for marking a session as requiring human intervention.
 * The real implementation (e.g. via a dedicated status store or an adapter
 * over GatewayConversationStore) satisfies this structurally. Kept narrow so
 * the hook does not take a compile-time dependency on the full platform store.
 *
 * `upsertContext` is optional: the api-side hook adapter does not have
 * channel/principalId in scope, so it omits ctx and falls back to
 * update-only (the row is guaranteed to exist before skill execution).
 * The gateway adapter passes ctx so first-message sessions get the row
 * created immediately.
 */
export interface ConversationStatusSetter {
  setConversationStatus(
    sessionId: string,
    organizationId: string,
    status: string,
    upsertContext?: ConversationStatusUpsertContext,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook dependencies
// ---------------------------------------------------------------------------

export interface DeterministicSafetyGateHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  bannedPhraseLoader: (jurisdiction: "SG" | "MY") => ReadonlyArray<BannedPhraseEntry>;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  postureCache: GovernancePostureCache;
  clock: () => Date;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * DeterministicSafetyGateHook — pre-output banned-phrase gate.
 *
 * Runs as `afterSkill()` BEFORE TracePersistenceHook. When a banned phrase
 * is detected and the mode is "enforce", the hook mutates `result.response`
 * in-place so every downstream consumer (including TracePersistenceHook) sees
 * the redacted handoff text instead of the original LLM output.
 *
 * Failure-mode discipline: emission integrity > persistence completeness.
 * If verdictStore, handoffStore, or conversationStore throw, the error is
 * logged and the block still proceeds.
 */
export class DeterministicSafetyGateHook implements SkillHook {
  readonly name = "deterministic-safety-gate";

  constructor(private readonly deps: DeterministicSafetyGateHookDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const { deploymentId, sessionId, orgId } = ctx;
    const {
      governanceConfigResolver,
      bannedPhraseLoader,
      verdictStore,
      handoffStore,
      conversationStore,
      postureCache,
      clock,
    } = this.deps;

    // ------------------------------------------------------------------
    // 1. Resolve governance config
    // ------------------------------------------------------------------
    const resolution = await governanceConfigResolver(deploymentId);

    if (resolution.status === "missing") {
      // No governance config — pass through, persist nothing.
      return;
    }

    if (resolution.status === "error") {
      return this.handleResolverError(
        deploymentId,
        sessionId,
        orgId,
        result,
        resolution.error,
        bannedPhraseLoader,
        verdictStore,
        handoffStore,
        conversationStore,
        postureCache,
        clock,
      );
    }

    // ------------------------------------------------------------------
    // 2. Resolved config — update cache, then scan
    // ------------------------------------------------------------------
    const { config } = resolution;
    const mode = resolveGovernanceMode(config);

    postureCache.remember(deploymentId, {
      mode,
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
    });

    if (mode === "off") {
      return;
    }

    const entries = bannedPhraseLoader(config.jurisdiction);
    const matches = scanForBannedPhrases(result.response, entries);

    if (matches.length === 0) {
      return; // Clean output — persist nothing.
    }

    const firstMatch = matches[0]!;
    const firstEntry = firstMatch.entry;
    const reasonCode = REASON_CODE_BY_CATEGORY[firstEntry.category];
    const decidedAt = clock().toISOString();
    const action = mode === "enforce" ? ("block" as const) : ("allow" as const);
    const auditLevel = mode === "enforce" ? ("critical" as const) : ("warning" as const);

    const verdictInput: SaveGovernanceVerdictInput = {
      action,
      reasonCode,
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
      sourceGuard: "banned_phrase_scanner",
      originalText: result.response,
      auditLevel,
      decidedAt,
      conversationId: sessionId,
      deploymentId,
      details: {
        matchCategory: firstEntry.category,
        matchId: firstEntry.id,
        matchedText: firstMatch.matched,
      },
    };

    // Persist verdict (errors must NOT skip the block in enforce mode).
    try {
      await verdictStore.save(verdictInput);
    } catch (err) {
      console.error(
        `[DeterministicSafetyGateHook] verdictStore.save failed (verdict still applied):`,
        err,
      );
    }

    if (mode === "observe") {
      return; // Log only — output unchanged.
    }

    // Enforce: flip status, save handoff, replace output.
    const handoffText = renderHandoffTemplate({
      jurisdiction: config.jurisdiction,
      reasonCode,
    });

    try {
      await conversationStore.setConversationStatus(sessionId, orgId, "human_override");
    } catch (err) {
      console.error(
        `[DeterministicSafetyGateHook] setConversationStatus failed (block still applied):`,
        err,
      );
    }

    try {
      await handoffStore.save(buildHandoffPackage(sessionId, orgId, result.trace.turnCount, clock));
    } catch (err) {
      console.error(
        `[DeterministicSafetyGateHook] handoffStore.save failed (block still applied):`,
        err,
      );
    }

    // In-place mutation — downstream hooks (e.g. TracePersistenceHook) see the handoff text.
    result.response = handoffText;
  }

  /**
   * Fail-closed path: resolver threw but posture cache has an enforce entry.
   * Uses cached jurisdiction/clinicType — never hardcoded defaults.
   */
  private async handleResolverError(
    deploymentId: string,
    sessionId: string,
    orgId: string,
    result: SkillExecutionResult,
    error: Error,
    bannedPhraseLoader: DeterministicSafetyGateHookDeps["bannedPhraseLoader"],
    verdictStore: GovernanceVerdictStore,
    handoffStore: HandoffStore,
    conversationStore: ConversationStatusSetter,
    postureCache: GovernancePostureCache,
    clock: () => Date,
  ): Promise<void> {
    const posture = postureCache.lastKnown(deploymentId);

    if (!posture || posture.mode !== "enforce") {
      console.error(
        `[DeterministicSafetyGateHook] Resolver error for "${deploymentId}" — failing open (no cached enforce posture):`,
        error,
      );
      return;
    }

    console.error(
      `[DeterministicSafetyGateHook] Resolver error for "${deploymentId}" — failing closed (cached ${posture.mode}/${posture.jurisdiction}/${posture.clinicType}):`,
      error,
    );

    const entries = bannedPhraseLoader(posture.jurisdiction);
    const matches = scanForBannedPhrases(result.response, entries);

    if (matches.length === 0) {
      return;
    }

    const firstMatch = matches[0]!;
    const firstEntry = firstMatch.entry;
    const reasonCode = "governance_unavailable" as const;
    const decidedAt = clock().toISOString();

    const verdictInput: SaveGovernanceVerdictInput = {
      action: "block",
      reasonCode,
      jurisdiction: posture.jurisdiction,
      clinicType: posture.clinicType,
      sourceGuard: "banned_phrase_scanner",
      originalText: result.response,
      auditLevel: "critical",
      decidedAt,
      conversationId: sessionId,
      deploymentId,
      details: {
        matchCategory: firstEntry.category,
        matchId: firstEntry.id,
        matchedText: firstMatch.matched,
      },
    };

    try {
      await verdictStore.save(verdictInput);
    } catch (err) {
      console.error(
        `[DeterministicSafetyGateHook] verdictStore.save failed (block still applied):`,
        err,
      );
    }

    const handoffText = renderHandoffTemplate({
      jurisdiction: posture.jurisdiction,
      reasonCode,
    });

    try {
      await conversationStore.setConversationStatus(sessionId, orgId, "human_override");
    } catch (err) {
      console.error(
        `[DeterministicSafetyGateHook] setConversationStatus failed (block still applied):`,
        err,
      );
    }

    try {
      await handoffStore.save(buildHandoffPackage(sessionId, orgId, result.trace.turnCount, clock));
    } catch (err) {
      console.error(
        `[DeterministicSafetyGateHook] handoffStore.save failed (block still applied):`,
        err,
      );
    }

    result.response = handoffText;
  }
}
