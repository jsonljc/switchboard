import type { DeploymentResolver } from "../platform/deployment-resolver.js";
import type { SubmitWorkResponse } from "../platform/platform-ingress.js";
import type { CanonicalSubmitRequest } from "../platform/canonical-request.js";
import type { ApprovalStore } from "../storage/interfaces.js";

export interface GatewayContactStore {
  findByPhone(orgId: string, phone: string): Promise<{ id: string } | null>;
  create(input: {
    organizationId: string;
    phone: string;
    primaryChannel: "whatsapp";
    source: string;
  }): Promise<{ id: string }>;
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
