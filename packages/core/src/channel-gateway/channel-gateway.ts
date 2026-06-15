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
import { getMetrics } from "../telemetry/metrics.js";
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
    if (response.result.outcome === "failed") {
      // A failed SkillMode result must never surface its internal error string to
      // the lead. Like the ok:false branch below, this sends ONLY the framework-
      // generated technical-failure notice (no agent/composer-authored text), so it
      // is permitted to bypass the consent gate.
      getMetrics().rawErrorFallback.inc({
        deploymentId: resolved.deploymentId,
        code: response.result.error?.code ?? "unknown",
      });
      try {
        await conversationStore.addMessage(
          conversationId,
          "assistant",
          "[suppressed:execution_failed]",
        );
      } catch (err) {
        console.error("[channel-gateway] execution-failure marker persist failed", err);
      }
      await replySink.send("I'm having trouble right now. Let me connect you with the team.");
      return;
    }
    if (response.result.outcome === "pending_approval") {
      // The outer governance gate parked the whole turn for human approval.
      // Never surface the raw framework summary ("Awaiting approval") to the
      // lead. Like the failed branch above, send ONLY a framework-generated
      // holding notice (no agent-authored text, so it bypasses the consent gate)
      // and persist a metadata-only marker so operators see the park.
      try {
        await conversationStore.addMessage(
          conversationId,
          "assistant",
          "[suppressed:pending_approval]",
        );
      } catch (err) {
        console.error("[channel-gateway] pending-approval marker persist failed", err);
      }
      await replySink.send("Thanks! Let me check on that and get back to you shortly.");
      return;
    }
    const text =
      typeof response.result.outputs.response === "string"
        ? response.result.outputs.response
        : response.result.summary;
    // Gate runs BEFORE addMessage(text) so a blocked outbound is never written
    // to the transcript — only the metadata marker below is persisted.
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
        try {
          await conversationStore.addMessage(
            conversationId,
            "assistant",
            "[suppressed:consent_revoked]",
          );
        } catch (err) {
          console.error("[channel-gateway] consent-suppression marker persist failed", err);
          // Verdict already persisted by gate; block decision stands.
        }
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
        // Binding identity: the stable channel USER id when the adapter supplied
        // one (Slack taps surface user.id as principalId while sessionId is the
        // channel), else sessionId (WhatsApp sessionId IS the phone; see
        // resolveContactIdentity.ts). Never an ephemeral message/thread id. See
        // OperatorChannelBinding model docs and bridge spec section 5.
        channel: message.channel,
        channelIdentifier: message.principalId ?? message.sessionId,
        approvalStore: this.config.approvalStore,
        replySink,
        config: this.config.approvalResponseConfig,
      });
      return;
    }

    // 3. Resolve contact identity FIRST (Spec-1A chain weld), then get/create
    // the conversation so the thread is keyed off the resolved contact/org.
    // No-op (contactId null) when contactStore is unwired or channel != whatsapp.
    const identity = this.config.contactStore
      ? await resolveContactIdentity({
          channel: message.channel,
          sessionId: message.sessionId,
          organizationId: resolved.organizationId,
          contactStore: this.config.contactStore,
          region: undefined,
        })
      : { contactId: null, phone: null, channel: message.channel };

    const { conversationId, messages: history } = await conversationStore.getOrCreateBySession(
      resolved.deploymentId,
      message.channel,
      message.sessionId,
      { organizationId: resolved.organizationId, contactId: identity.contactId },
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

    // 4c. (Identity already resolved in step 3 above for the chain weld.)
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
      ...(message.providerMessageId
        ? {
            idempotencyKey: `${resolved.organizationId}:${message.channel}:${message.providerMessageId}`,
          }
        : {}),
      targetHint: {
        skillSlug: resolved.skillSlug,
        deploymentId: resolved.deploymentId,
        channel: message.channel,
        token: message.token,
      },
      // Spec-1A chain weld: server-resolved lineage for WorkTrace columns.
      // These are NOT derived from parameters — they are populated here so
      // normalizeWorkUnit can persist them without an extra join.
      contactId: identity.contactId ?? undefined,
      conversationThreadId: conversationId,
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
