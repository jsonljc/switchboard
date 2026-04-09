export interface HandoffPayload {
  fromAgent: string;
  reason: string;
  conversationId?: string;
  context: Record<string, unknown>;
}
