// ---------------------------------------------------------------------------
// Conversation Store — persistence interface for conversation state
// ---------------------------------------------------------------------------

export type LifecycleStage = "lead" | "qualified" | "booked" | "treated" | "churned";

export interface Message {
  id: string;
  contactId: string;
  direction: "inbound" | "outbound";
  content: string;
  timestamp: string;
  channel: "whatsapp" | "telegram" | "dashboard" | "web_widget";
  metadata?: Record<string, unknown>;
}

export interface ConversationStore {
  getHistory(contactId: string): Promise<Message[]>;
  appendMessage(contactId: string, message: Message): Promise<void>;
  getStage(contactId: string): Promise<LifecycleStage>;
  setStage(contactId: string, stage: LifecycleStage): Promise<void>;
  /**
   * @deprecated Read messaging consent from `Contact.messagingOptIn` instead. The
   * `ContactLifecycle.optedOut` boolean predates WhatsApp consent tracking, has no
   * timestamp/source, and is not gating any production send path. Kept for now to
   * avoid breaking existing tests; remove when the last reference migrates to the
   * Contact-level fields.
   */
  isOptedOut(contactId: string): Promise<boolean>;
  /**
   * @deprecated Use `ContactStore.recordMessagingOptOut(orgId, contactId)` for new
   * WhatsApp opt-out flows. See `isOptedOut` for context.
   */
  setOptOut(contactId: string, optedOut: boolean): Promise<void>;
}
