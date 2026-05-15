import type { DeploymentResolver } from "../platform/deployment-resolver.js";
import type { SubmitWorkResponse } from "../platform/platform-ingress.js";
import type { CanonicalSubmitRequest } from "../platform/canonical-request.js";
import type { ApprovalStore, IdentityStore } from "../storage/interfaces.js";
import type { GovernanceConfigResolver } from "../governance/governance-config-resolver.js";
import type { EscalationTriggerEntry } from "../governance/escalation-triggers/types.js";
import type { GovernanceVerdictStore } from "../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../governance/posture-cache.js";
import type { HandoffStore } from "../handoff/types.js";
import type { ConsentService } from "../consent/consent-service.js";
import type { RevocationKeywordEntry } from "../consent/revocation-keywords/types.js";
import type { PdpaJurisdiction } from "@switchboard/schemas";
import type { OperatorChannelBindingStore } from "./operator-channel-binding-store.js";
import type { RespondToApprovalDeps } from "../approval/respond-to-approval.js";
import type { ConversationStatusUpsertContext } from "./conversation-status-types.js";

export interface GatewayContactStore {
  findByPhone(orgId: string, phone: string): Promise<{ id: string } | null>;
  create(input: {
    organizationId: string;
    phone: string;
    primaryChannel: "whatsapp";
    source: string;
    messagingOptIn?: boolean;
    messagingOptInSource?: "ctwa" | "organic_inbound" | "web_form" | "manual";
  }): Promise<{ id: string }>;
  /** Records a WhatsApp messaging opt-out triggered by inbound STOP/UNSUBSCRIBE keyword. */
  recordMessagingOptOut?(orgId: string, contactId: string): Promise<void>;
}

export type { ConversationStatusUpsertContext };

/**
 * Minimal interface for marking a session as requiring human intervention
 * from within the gateway (pre-input gate). The real implementation
 * (adapter over ConversationStateStore or GatewayConversationStore) satisfies
 * this structurally. Kept narrow so the gateway does not take a compile-time
 * dependency on the full platform store. Task 14 wires the real adapter.
 *
 * `upsertContext` is optional: when provided (gateway path), the adapter
 * performs a true upsert so a brand-new session gets a ConversationState row
 * immediately. When omitted (api-side hook path), the adapter falls back to
 * update-only because the row is guaranteed to exist before skill execution.
 */
export interface GatewayConversationStatusSetter {
  setConversationStatus(
    sessionId: string,
    status: string,
    upsertContext?: ConversationStatusUpsertContext,
  ): Promise<void>;
}

/**
 * Configuration to enable chat approval execution. When provided, hash-match success
 * triggers an OperatorChannelBinding lookup → role check → shared respondToApproval call,
 * mutating the approval lifecycle the same way the API route does. When omitted (e.g.,
 * tests, misconfiguration), hash-match succeeds but the response is "not authorized" —
 * we MUST NOT execute on hash match alone (channel-possession ≠ authority).
 */
export interface HandleApprovalResponseConfig {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
}

export interface ChannelGatewayConfig {
  conversationStore: GatewayConversationStore;
  /** Called after each message is persisted. MUST be synchronous — async callbacks are not awaited. */
  onMessageRecorded?: (info: {
    deploymentId: string;
    listingId: string;
    organizationId: string;
    channel: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    workTraceId?: string;
  }) => void;
  /** Deployment resolver for converged execution path */
  deploymentResolver: DeploymentResolver;
  /** Platform ingress for converged execution path */
  platformIngress: { submit(request: CanonicalSubmitRequest): Promise<SubmitWorkResponse> };
  /** Optional contact-identity store. When set, the gateway resolves Contact identity for WhatsApp inbound before ingress.submit. */
  contactStore?: GatewayContactStore;
  /**
   * Read-only approval lookup for binding-hash verification of
   * approval-shaped channel payloads. Required so verification
   * cannot be silently skipped by misconfiguration.
   */
  approvalStore: ApprovalStore;
  /**
   * Optional config to enable chat approval execution. When omitted, approval-shaped
   * payloads with valid binding hashes are rejected with a "not authorized" reply
   * (channel-possession is NOT authority). When provided, hash match → binding lookup →
   * role check → shared respondToApproval call mutates the lifecycle.
   */
  approvalResponseConfig?: HandleApprovalResponseConfig;
  // ---------------------------------------------------------------------------
  // Pre-input deterministic gate deps (Task 13)
  // All optional — when omitted, the gate is skipped (backward compatibility).
  // ---------------------------------------------------------------------------
  /**
   * Resolves per-deployment governance config. When omitted, the gate is skipped.
   */
  governanceConfigResolver?: GovernanceConfigResolver;
  /**
   * Loads escalation trigger entries for a jurisdiction. When omitted, the gate is skipped.
   */
  escalationTriggerLoader?: (jurisdiction: "SG" | "MY") => ReadonlyArray<EscalationTriggerEntry>;
  /**
   * Persists governance audit verdicts. When omitted, the gate is skipped.
   */
  verdictStore?: GovernanceVerdictStore;
  /**
   * Cache for the last-known governance posture per deployment — enables
   * fail-closed behaviour on resolver error. Shared instance with the
   * pre-output banned-phrase gate.
   */
  postureCache?: GovernancePostureCache;
  /**
   * Persists the handoff package on enforce-mode escalation.
   */
  handoffStore?: HandoffStore;
  /**
   * Adapter for flipping conversation status to human_override on escalation.
   * When omitted, the flip step is skipped (errors logged in enforce path).
   */
  conversationStatusSetter?: GatewayConversationStatusSetter;
  // ---------------------------------------------------------------------------
  // Pre-input consent revocation gate deps (Phase 1c).
  // Optional — when omitted, the gate is a pass-through (backward compat).
  // Runs BEFORE the 1b-1 escalation gate; user revocation takes precedence
  // over medical-safety/compliance triggers.
  // ---------------------------------------------------------------------------
  consentRevocationGate?: {
    governanceConfigResolver: GovernanceConfigResolver;
    consentService: ConsentService;
    postureCache: GovernancePostureCache;
    revocationKeywordLoader: (j: PdpaJurisdiction) => ReadonlyArray<RevocationKeywordEntry>;
    sessionContactResolver: (sessionId: string) => Promise<string | null>;
    verdictStore: GovernanceVerdictStore;
    clock: () => Date;
  };
}

export interface GatewayConversationStore {
  getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  addMessage(conversationId: string, role: string, content: string): Promise<void>;
  getConversationStatus?(sessionId: string): Promise<string | null>;
}

export interface IncomingChannelMessage {
  channel: string;
  token: string;
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string };
}

export interface ReplySink {
  send(text: string): Promise<void>;
  onToken?(chunk: string): void;
  onTyping?(): void;
}

export class UnknownChannelError extends Error {
  constructor(channel: string, token: string) {
    super(`No deployment found for channel=${channel} token=${token.slice(0, 6)}...`);
    this.name = "UnknownChannelError";
  }
}

export class InactiveDeploymentError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} is not active`);
    this.name = "InactiveDeploymentError";
  }
}
