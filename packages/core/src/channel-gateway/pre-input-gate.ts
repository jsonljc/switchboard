import { createId } from "@paralleldrive/cuid2";
import { resolveGovernanceMode } from "@switchboard/schemas";
import type { ChannelGatewayConfig, ConversationStatusUpsertContext, ReplySink } from "./types.js";
import type { GatewayConversationStatusSetter } from "./types.js";
import { scanForEscalationTriggers } from "../governance/scanner/escalation-trigger-scanner.js";
import { renderHandoffTemplate } from "../governance/handoff-template.js";
import {
  REASON_CODE_BY_TRIGGER,
  handoffReasonForTriggerCategory,
} from "../governance/escalation-triggers/types.js";
import type {
  GovernanceVerdictStore,
  SaveGovernanceVerdictInput,
} from "../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../governance/posture-cache.js";
import type { HandoffStore, Handoff } from "../handoff/types.js";

/**
 * Pre-input deterministic gate.
 *
 * Runs between identity resolution and platformIngress.submit().
 * Returns `true` when the inbound message has been escalated and submit MUST
 * be skipped; `false` when submit should proceed normally.
 *
 * Failure-mode discipline: persistence errors are logged but do NOT skip the
 * enforcement block. The caller checks the return value, not an exception.
 *
 * `channel` is passed so the status setter adapter can upsert a
 * ConversationState row if none exists yet (first-message sessions).
 *
 * Extracted from ChannelGateway in 1b-1 to keep channel-gateway.ts under
 * the 600-line architecture threshold. Pure function, no `this` — deps and
 * per-turn context are arguments.
 */
export async function runPreInputGate(
  config: ChannelGatewayConfig,
  inboundText: string,
  sessionId: string,
  channel: string,
  deploymentId: string,
  organizationId: string,
  replySink: ReplySink,
): Promise<boolean> {
  const {
    governanceConfigResolver,
    escalationTriggerLoader,
    verdictStore,
    postureCache,
    handoffStore,
    conversationStatusSetter,
  } = config;

  // Gate is opt-in. Skip entirely if not wired.
  if (!governanceConfigResolver || !escalationTriggerLoader || !verdictStore || !postureCache) {
    return false;
  }

  // ------------------------------------------------------------------
  // 1. Resolve governance config
  // ------------------------------------------------------------------
  const resolution = await governanceConfigResolver(deploymentId);

  if (resolution.status === "missing") {
    // No governance config — pass through, persist nothing.
    return false;
  }

  if (resolution.status === "error") {
    return handleInputGateResolverError(
      config,
      resolution.error,
      inboundText,
      sessionId,
      channel,
      deploymentId,
      organizationId,
      verdictStore,
      postureCache,
      handoffStore,
      conversationStatusSetter,
      replySink,
    );
  }

  // ------------------------------------------------------------------
  // 2. Resolved config — update cache, then scan
  // ------------------------------------------------------------------
  const { config: governance } = resolution;
  const mode = resolveGovernanceMode(governance);

  postureCache.remember(deploymentId, {
    mode,
    jurisdiction: governance.jurisdiction,
    clinicType: governance.clinicType,
  });

  if (mode === "off") {
    return false;
  }

  const entries = escalationTriggerLoader(governance.jurisdiction);
  const matches = scanForEscalationTriggers(inboundText, entries);

  if (matches.length === 0) {
    return false; // Clean inbound — persist nothing.
  }

  const firstMatch = matches[0]!;
  const firstEntry = firstMatch.entry;
  const reasonCode = REASON_CODE_BY_TRIGGER[firstEntry.category];
  const decidedAt = new Date().toISOString();
  const action = mode === "enforce" ? ("escalate" as const) : ("allow" as const);
  const auditLevel = mode === "enforce" ? ("critical" as const) : ("warning" as const);

  const verdictInput: SaveGovernanceVerdictInput = {
    action,
    reasonCode,
    jurisdiction: governance.jurisdiction,
    clinicType: governance.clinicType,
    sourceGuard: "escalation_trigger",
    originalText: inboundText,
    auditLevel,
    decidedAt,
    conversationId: sessionId,
    deploymentId,
    details: {
      matchCategory: firstEntry.category,
      matchId: firstEntry.id,
      matchedText: firstMatch.matched,
      sentence: firstMatch.sentence,
    },
  };

  // Persist verdict (errors must NOT skip the block in enforce mode).
  try {
    await verdictStore.save(verdictInput);
  } catch (err) {
    console.error(
      `[ChannelGateway] pre-input gate: verdictStore.save failed (verdict still applied):`,
      err,
    );
  }

  if (mode === "observe") {
    return false; // Log only — proceed to submit.
  }

  // Enforce: flip status, save handoff, send handoff text.
  const handoffText = renderHandoffTemplate({
    jurisdiction: governance.jurisdiction,
    reasonCode,
  });

  if (conversationStatusSetter) {
    try {
      // Pass upsertContext so the adapter can create the ConversationState
      // row for brand-new sessions (first-message path) where no row exists
      // yet. principalId is the bare sessionId: it is read back as
      // destinationPrincipalId and POSTed to the channel `to` (a "visitor-"
      // prefix is not a deliverable address). This matches the normal inbound
      // path, which mints principalId = the bare channel identity.
      const upsertContext: ConversationStatusUpsertContext = {
        channel,
        principalId: sessionId,
      };
      await conversationStatusSetter.setConversationStatus(
        sessionId,
        "human_override",
        upsertContext,
      );
    } catch (err) {
      console.error(
        `[ChannelGateway] pre-input gate: setConversationStatus failed (block still applied):`,
        err,
      );
    }
  }

  if (handoffStore) {
    try {
      await handoffStore.save(
        buildInputHandoffPackage(
          sessionId,
          organizationId,
          handoffReasonForTriggerCategory(firstEntry.category),
          () => new Date(),
        ),
      );
    } catch (err) {
      console.error(
        `[ChannelGateway] pre-input gate: handoffStore.save failed (block still applied):`,
        err,
      );
    }
  }

  await replySink.send(handoffText);
  return true; // Short-circuit submit.
}

/**
 * Fail-closed path: resolver threw but posture cache has an enforce entry.
 *
 * Symmetric with the output hook's handleResolverError: tables (escalation
 * triggers) are TypeScript constants that remain available even when the
 * resolver fails. We scan inbound text using the cached jurisdiction's table.
 *
 * Decision tree:
 *   - no cached posture, or posture not "enforce" → fail open (return false)
 *   - cached enforce + NO trigger match → log the resolver error but PROCEED
 *     (return false). The text is clean; blocking would be a false positive.
 *   - cached enforce + trigger match → block as usual.
 *
 * reasonCode: REASON_CODE_BY_TRIGGER from the matched entry category — more
 * informative than a bare "governance_unavailable", which would obscure what
 * actually fired. The resolver failure is captured in the console.error above
 * and in the verdict's sourceGuard ("escalation_trigger").
 *
 * Uses cached jurisdiction/clinicType — never hardcoded defaults.
 */
async function handleInputGateResolverError(
  config: ChannelGatewayConfig,
  error: Error,
  inboundText: string,
  sessionId: string,
  channel: string,
  deploymentId: string,
  organizationId: string,
  verdictStore: GovernanceVerdictStore,
  postureCache: GovernancePostureCache,
  handoffStore: HandoffStore | undefined,
  conversationStatusSetter: GatewayConversationStatusSetter | undefined,
  replySink: ReplySink,
): Promise<boolean> {
  const posture = postureCache.lastKnown(deploymentId);

  if (!posture || posture.mode !== "enforce") {
    console.error(
      `[ChannelGateway] pre-input gate: resolver error for "${deploymentId}" — failing open (no cached enforce posture):`,
      error,
    );
    return false;
  }

  console.error(
    `[ChannelGateway] pre-input gate: resolver error for "${deploymentId}" — failing closed with scan (cached ${posture.mode}/${posture.jurisdiction}/${posture.clinicType}):`,
    error,
  );

  // Scan inbound text using the cached jurisdiction's trigger table.
  // Tables are TS constants — available even when the resolver fails.
  // If the text is clean, proceed rather than unconditionally blocking.
  const { escalationTriggerLoader } = config;
  if (!escalationTriggerLoader) {
    // Gate was wired without a loader — cannot scan, fail open.
    console.error(
      `[ChannelGateway] pre-input gate: no escalationTriggerLoader in cached-enforce path — failing open`,
    );
    return false;
  }

  const triggers = escalationTriggerLoader(posture.jurisdiction);
  const matches = scanForEscalationTriggers(inboundText, triggers);

  if (matches.length === 0) {
    // Resolver failed but text is clean — log and proceed to submit.
    console.error(
      `[ChannelGateway] pre-input gate: resolver error for "${deploymentId}" — scan-still-clean, proceeding (cached ${posture.jurisdiction}/${posture.clinicType}):`,
      error,
    );
    return false;
  }

  const firstMatch = matches[0]!;
  const firstEntry = firstMatch.entry;
  // Use the trigger's natural reason code — more informative than a generic
  // "governance_unavailable" because the actual trigger category is known.
  const reasonCode = REASON_CODE_BY_TRIGGER[firstEntry.category];
  const decidedAt = new Date().toISOString();

  const verdictInput: SaveGovernanceVerdictInput = {
    action: "escalate",
    reasonCode,
    jurisdiction: posture.jurisdiction,
    clinicType: posture.clinicType,
    sourceGuard: "escalation_trigger",
    originalText: inboundText,
    auditLevel: "critical",
    decidedAt,
    conversationId: sessionId,
    deploymentId,
    details: {
      matchCategory: firstEntry.category,
      matchId: firstEntry.id,
      matchedText: firstMatch.matched,
      sentence: firstMatch.sentence,
    },
  };

  try {
    await verdictStore.save(verdictInput);
  } catch (err) {
    console.error(
      `[ChannelGateway] pre-input gate: verdictStore.save failed (block still applied):`,
      err,
    );
  }

  const handoffText = renderHandoffTemplate({
    jurisdiction: posture.jurisdiction,
    reasonCode,
  });

  if (conversationStatusSetter) {
    try {
      // Pass upsertContext so the adapter can create the ConversationState
      // row for brand-new sessions (first-message path) where no row exists
      // yet. principalId is the bare sessionId: it is read back as
      // destinationPrincipalId and POSTed to the channel `to` (a "visitor-"
      // prefix is not a deliverable address). This matches the normal inbound
      // path, which mints principalId = the bare channel identity.
      const upsertContext: ConversationStatusUpsertContext = {
        channel,
        principalId: sessionId,
      };
      await conversationStatusSetter.setConversationStatus(
        sessionId,
        "human_override",
        upsertContext,
      );
    } catch (err) {
      console.error(
        `[ChannelGateway] pre-input gate: setConversationStatus failed (block still applied):`,
        err,
      );
    }
  }

  if (handoffStore) {
    try {
      await handoffStore.save(
        buildInputHandoffPackage(
          sessionId,
          organizationId,
          handoffReasonForTriggerCategory(firstEntry.category),
          () => new Date(),
        ),
      );
    } catch (err) {
      console.error(
        `[ChannelGateway] pre-input gate: handoffStore.save failed (block still applied):`,
        err,
      );
    }
  }

  await replySink.send(handoffText);
  return true; // Short-circuit submit.
}

function buildInputHandoffPackage(
  sessionId: string,
  orgId: string,
  reason: Handoff["reason"],
  clock: () => Date,
): Handoff {
  return {
    id: createId(),
    sessionId,
    organizationId: orgId,
    reason,
    status: "pending",
    leadSnapshot: { channel: "channel" },
    qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
    conversationSummary: {
      turnCount: 0,
      keyTopics: [],
      objectionHistory: [],
      sentiment: "neutral",
    },
    slaDeadlineAt: new Date(clock().getTime() + 4 * 60 * 60 * 1000), // 4 h SLA
    createdAt: clock(),
  };
}
