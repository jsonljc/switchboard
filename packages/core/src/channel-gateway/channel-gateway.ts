import type {
  ChannelGatewayConfig,
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
import { runPreInputGate } from "./pre-input-gate.js";
import { runConsentRevocationGate } from "./consent-revocation-gate.js";
import { runConsentEnforcementGate } from "./consent-enforcement-gate.js";

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
  consentEnforcementGate: ChannelGatewayConfig["consentEnforcementGate"];
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
    consentEnforcementGate,
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
    if (consentEnforcementGate) {
      const outcome = await runConsentEnforcementGate({
        cfg: consentEnforcementGate,
        outboundText: text,
        sessionId,
        deploymentId: resolved.deploymentId,
        channel: message.channel,
      });
      if (outcome === "blocked") {
        // Audit row already persisted by the gate. Persist a metadata-only
        // transcript marker so operators see something happened, but do NOT
        // include the generated text — a contact who said STOP shouldn't
        // have the would-have-been-said reply preserved in their transcript.
        // Verdict already captures channel + contactId + outboundLength.
        await conversationStore.addMessage(
          conversationId,
          "assistant",
          "[suppressed:consent_revoked]",
        );
        return;
      }
    }
    await conversationStore.addMessage(conversationId, "assistant", text);
    onMessageRecorded?.({
      deploymentId: resolved.deploymentId,
      listingId: resolved.listingId,
      organizationId: resolved.organizationId,
      channel: message.channel,
      sessionId: message.sessionId,
      role: "assistant",
      content: text,
      workTraceId: response.result.traceId,
    });
    await replySink.send(text);
  } else {
    // Only framework-generated technical-failure notices may bypass the
    // consent gate. Any agent/composer-authored outbound text MUST pass
    // the gate above. Do not move that branch outside the `if (consentEnforcementGate)` block.
    await replySink.send("I'm having trouble right now. Let me connect you with the team.");
  }
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

      // Phase 1c — also record PDPA revocation when consent gate is configured.
      // The WhatsApp opt-out path is a channel-layer signal; PDPA revocation is
      // the data-subject-rights superset. Recording both keeps the audit trail
      // aligned and ensures enforce-mode consent gates fire on subsequent turns.
      if (this.config.consentRevocationGate) {
        const cfg = this.config.consentRevocationGate;
        const contactId = identity.contactId;
        try {
          await cfg.consentService.recordRevocation({
            contactId,
            source: "inbound_keyword_revocation",
            revokedAt: cfg.clock(),
            actor: "system:whatsapp_opt_out",
            notes: `WhatsApp opt-out keyword on channel ${message.channel}`,
            openConversationSessionId: message.sessionId,
            organizationId: resolved.organizationId,
            deploymentId: resolved.deploymentId,
          });
        } catch (err) {
          console.error("[channel-gateway] PDPA revocation from WhatsApp opt-out failed", err);
          // Do not block — the WhatsApp opt-out is the primary signal; PDPA
          // mirror is best-effort.
        }
      }

      await replySink.send(OPT_OUT_CONFIRMATION);
      return;
    }

    // 4e-pre. Pre-input consent revocation gate (Phase 1c). Runs BEFORE the
    // 1b-1 escalation gate so user revocation takes precedence over medical-
    // safety/compliance triggers.
    if (this.config.consentRevocationGate) {
      const consentOutcome = await runConsentRevocationGate({
        cfg: this.config.consentRevocationGate,
        inboundText: message.text,
        sessionId: message.sessionId,
        deploymentId: resolved.deploymentId,
        organizationId: resolved.organizationId,
        replySink,
      });
      if (consentOutcome === "revoked") return;
    }

    // 4e. Pre-input deterministic gate — must run before typing signal and submit.
    // Scans inbound text for escalation triggers; may short-circuit on enforce match.
    const gateBlocked = await runPreInputGate(
      this.config,
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
      consentEnforcementGate: this.config.consentEnforcementGate,
    });
  }
}
