import { createId } from "@paralleldrive/cuid2";
import type {
  ChannelGatewayConfig,
  ConversationStatusUpsertContext,
  GatewayConversationStore,
  IncomingChannelMessage,
  ReplySink,
} from "./types.js";
import type { CanonicalSubmitRequest } from "../platform/canonical-request.js";
import type { SubmitWorkResponse } from "../platform/platform-ingress.js";
import type { DeploymentResolverResult } from "../platform/deployment-resolver.js";
import { DeploymentInactiveError } from "../platform/deployment-resolver.js";
import { resolveContactIdentity } from "./resolve-contact-identity.js";
import { parseApprovalResponsePayload } from "./approval-response-payload.js";
import { handleApprovalResponse } from "./handle-approval-response.js";
import { isOptOutKeyword } from "./opt-out-keywords.js";
import { scanForEscalationTriggers } from "../governance/scanner/escalation-trigger-scanner.js";
import { renderHandoffTemplate } from "../governance/handoff-template.js";
import { REASON_CODE_BY_TRIGGER } from "../governance/escalation-triggers/types.js";
import { resolveGovernanceMode } from "@switchboard/schemas";
import type {
  GovernanceVerdictStore,
  SaveGovernanceVerdictInput,
} from "../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../governance/posture-cache.js";
import type { HandoffStore, HandoffPackage } from "../handoff/types.js";
import type { GatewayConversationStatusSetter } from "./types.js";

const OPT_OUT_CONFIRMATION =
  "You've been opted out of WhatsApp messages from us. Reply START at any time to opt back in.";

const MAX_HISTORY_MESSAGES = 30;

/** Dispatch the submit response — suppressed if operator has taken over mid-flight. */
async function dispatchResponse(params: {
  response: SubmitWorkResponse;
  sessionId: string;
  conversationId: string;
  conversationStore: GatewayConversationStore;
  resolved: DeploymentResolverResult;
  message: IncomingChannelMessage;
  onMessageRecorded: ChannelGatewayConfig["onMessageRecorded"];
  replySink: ReplySink;
}): Promise<void> {
  const {
    response,
    sessionId,
    conversationId,
    conversationStore,
    resolved,
    message,
    onMessageRecorded,
    replySink,
  } = params;

  // Re-check override status — operator may have toggled during skill execution
  if (conversationStore.getConversationStatus) {
    const postStatus = await conversationStore.getConversationStatus(sessionId);
    if (postStatus === "human_override") {
      // Operator took over mid-flight — discard AI response, persist it silently
      if (response.ok) {
        const text =
          typeof response.result.outputs.response === "string"
            ? response.result.outputs.response
            : response.result.summary;
        await conversationStore.addMessage(conversationId, "assistant", `[suppressed] ${text}`);
      }
      return;
    }
  }

  if (response.ok) {
    const text =
      typeof response.result.outputs.response === "string"
        ? response.result.outputs.response
        : response.result.summary;
    await conversationStore.addMessage(conversationId, "assistant", text);
    onMessageRecorded?.({
      deploymentId: resolved.deploymentId,
      listingId: resolved.listingId,
      organizationId: resolved.organizationId,
      channel: message.channel,
      sessionId: message.sessionId,
      role: "assistant",
      content: text,
    });
    await replySink.send(text);
  } else {
    await replySink.send("I'm having trouble right now. Let me connect you with the team.");
  }
}

// ---------------------------------------------------------------------------
// Pre-input gate helpers
// ---------------------------------------------------------------------------

function buildInputHandoffPackage(
  sessionId: string,
  orgId: string,
  clock: () => Date,
): HandoffPackage {
  return {
    id: createId(),
    sessionId,
    organizationId: orgId,
    reason: "compliance_concern",
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

export class ChannelGateway {
  constructor(private config: ChannelGatewayConfig) {}

  async handleIncoming(message: IncomingChannelMessage, replySink: ReplySink): Promise<void> {
    const { deploymentResolver, platformIngress, conversationStore } = this.config;

    // 1. Resolve deployment
    let resolved;
    try {
      resolved = await deploymentResolver.resolveByChannelToken(message.channel, message.token);
    } catch (err) {
      if (err instanceof DeploymentInactiveError) {
        // Persist inbound message so owners can see what was missed while paused
        try {
          const { conversationId } = await conversationStore.getOrCreateBySession(
            err.deploymentId,
            message.channel,
            message.sessionId,
          );
          await conversationStore.addMessage(conversationId, "user", message.text);
        } catch {
          // Best-effort: don't fail the paused reply if persistence fails
        }
        await replySink.send("This service is temporarily paused. Please try again later.");
        return;
      }
      throw err;
    }

    // 2. Intercept approval-shaped payloads. Once parsed, the branch is
    // terminal: no onTyping, no inbound persistence, no submit, no LLM.
    const approvalPayload = parseApprovalResponsePayload(message.text);
    if (approvalPayload) {
      await handleApprovalResponse({
        payload: approvalPayload,
        organizationId: resolved.organizationId,
        // sessionId IS the stable external identity for WhatsApp (phone) — see
        // resolveContactIdentity.ts (sessionId === phone for WhatsApp). For other channels,
        // the inbound adapter MUST set sessionId to a stable identity (channel user id), never
        // an ephemeral message thread id. See OperatorChannelBinding model docs.
        channel: message.channel,
        channelIdentifier: message.sessionId,
        approvalStore: this.config.approvalStore,
        replySink,
        config: this.config.approvalResponseConfig,
      });
      return;
    }

    // 3. Get/create conversation
    const { conversationId, messages: history } = await conversationStore.getOrCreateBySession(
      resolved.deploymentId,
      message.channel,
      message.sessionId,
    );

    // 4. Persist incoming message
    await conversationStore.addMessage(conversationId, "user", message.text);
    this.config.onMessageRecorded?.({
      deploymentId: resolved.deploymentId,
      listingId: resolved.listingId,
      organizationId: resolved.organizationId,
      channel: message.channel,
      sessionId: message.sessionId,
      role: "user",
      content: message.text,
    });

    // 4b. Check for human override — skip skill dispatch if owner has taken over
    if (this.config.conversationStore.getConversationStatus) {
      const status = await this.config.conversationStore.getConversationStatus(message.sessionId);
      if (status === "human_override") {
        return;
      }
    }

    // 4c. Resolve contact identity (no-op when contactStore not wired or non-WhatsApp channel)
    const identity = this.config.contactStore
      ? await resolveContactIdentity({
          channel: message.channel,
          sessionId: message.sessionId,
          organizationId: resolved.organizationId,
          contactStore: this.config.contactStore,
        })
      : { contactId: null, phone: null, channel: message.channel };

    // 4d. WhatsApp opt-out keyword detection — terminal branch.
    // STOP / UNSUBSCRIBE / OPT OUT records the opt-out, replies confirmation,
    // and skips skill dispatch. Required for WhatsApp Business API compliance.
    if (
      message.channel === "whatsapp" &&
      identity.contactId &&
      this.config.contactStore?.recordMessagingOptOut &&
      isOptOutKeyword(message.text)
    ) {
      await this.config.contactStore.recordMessagingOptOut(
        resolved.organizationId,
        identity.contactId,
      );
      await replySink.send(OPT_OUT_CONFIRMATION);
      return;
    }

    // 4e. Pre-input deterministic gate — must run before typing signal and submit.
    // Scans inbound text for escalation triggers; may short-circuit on enforce match.
    const gateBlocked = await this.runPreInputGate(
      message.text,
      message.sessionId,
      message.channel,
      resolved.deploymentId,
      resolved.organizationId,
      replySink,
    );
    if (gateBlocked) {
      return;
    }

    // 5. Signal typing
    replySink.onTyping?.();

    // 6. Build conversation context
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const messages = [...recentHistory, { role: "user", content: message.text }].map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // 7. Build CanonicalSubmitRequest
    const request: CanonicalSubmitRequest = {
      organizationId: resolved.organizationId,
      actor: { id: message.sessionId, type: "user" as const },
      intent: `${resolved.skillSlug}.respond`,
      parameters: {
        message: message.text,
        conversation: { messages, sessionId: message.sessionId },
        persona: resolved.persona,
        ...(identity.contactId ? { contactId: identity.contactId } : {}),
        ...(identity.phone ? { phone: identity.phone } : {}),
        channel: identity.channel,
        _agentContext: { persona: resolved.persona },
      },
      trigger: "chat" as const,
      surface: { surface: "chat", sessionId: message.sessionId },
      targetHint: {
        skillSlug: resolved.skillSlug,
        deploymentId: resolved.deploymentId,
        channel: message.channel,
        token: message.token,
      },
    };

    // 8. Submit through PlatformIngress and dispatch response
    const response = await platformIngress.submit(request);
    await dispatchResponse({
      response,
      sessionId: message.sessionId,
      conversationId,
      conversationStore,
      resolved,
      message,
      onMessageRecorded: this.config.onMessageRecorded,
      replySink,
    });
  }

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
   */
  private async runPreInputGate(
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
    } = this.config;

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
      return this.handleInputGateResolverError(
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
    const { config } = resolution;
    const mode = resolveGovernanceMode(config);

    postureCache.remember(deploymentId, {
      mode,
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
    });

    if (mode === "off") {
      return false;
    }

    const entries = escalationTriggerLoader(config.jurisdiction);
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
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
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
      jurisdiction: config.jurisdiction,
      reasonCode,
    });

    if (conversationStatusSetter) {
      try {
        // Pass upsertContext so the adapter can create the ConversationState
        // row for brand-new sessions (first-message path) where no row exists
        // yet. principalId mirrors gateway-conversation-store.ts derivation.
        const upsertContext: ConversationStatusUpsertContext = {
          channel,
          principalId: `visitor-${sessionId}`,
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
          buildInputHandoffPackage(sessionId, organizationId, () => new Date()),
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
  private async handleInputGateResolverError(
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
    const { escalationTriggerLoader } = this.config;
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
        // yet. principalId mirrors gateway-conversation-store.ts derivation.
        const upsertContext: ConversationStatusUpsertContext = {
          channel,
          principalId: `visitor-${sessionId}`,
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
          buildInputHandoffPackage(sessionId, organizationId, () => new Date()),
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
}
