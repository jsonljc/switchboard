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
  channel: "whatsapp" | "telegram" | "dashboard";
  metadata?: Record<string, unknown>;
}

export interface ConversationStore {
  getHistory(contactId: string): Promise<Message[]>;
  appendMessage(contactId: string, message: Message): Promise<void>;
  getStage(contactId: string): Promise<LifecycleStage>;
  setStage(contactId: string, stage: LifecycleStage): Promise<void>;
  isOptedOut(contactId: string): Promise<boolean>;
  setOptOut(contactId: string, optedOut: boolean): Promise<void>;
}
