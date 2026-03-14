// ---------------------------------------------------------------------------
// Human Handoff — Types
// ---------------------------------------------------------------------------

export type HandoffReason =
  | "human_requested"
  | "max_turns_exceeded"
  | "complex_objection"
  | "negative_sentiment"
  | "compliance_concern"
  | "booking_failure"
  | "escalation_timeout";

export type HandoffStatus = "pending" | "assigned" | "active" | "released";

export interface LeadSnapshot {
  leadId?: string;
  name?: string;
  phone?: string;
  email?: string;
  serviceInterest?: string;
  channel: string;
  source?: string;
}

export interface QualificationSnapshot {
  signalsCaptured: Record<string, unknown>;
  qualificationStage: string;
  leadScore?: number;
}

export interface ConversationSummary {
  turnCount: number;
  keyTopics: string[];
  objectionHistory: string[];
  sentiment: string;
  suggestedOpening?: string;
}

export interface HandoffPackage {
  id: string;
  sessionId: string;
  organizationId: string;
  reason: HandoffReason;
  status: HandoffStatus;
  leadSnapshot: LeadSnapshot;
  qualificationSnapshot: QualificationSnapshot;
  conversationSummary: ConversationSummary;
  slaDeadlineAt: Date;
  createdAt: Date;
  acknowledgedAt?: Date;
}

export interface HandoffStore {
  save(pkg: HandoffPackage): Promise<void>;
  getById(id: string): Promise<HandoffPackage | null>;
  getBySessionId(sessionId: string): Promise<HandoffPackage | null>;
  updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void>;
  listPending(organizationId: string): Promise<HandoffPackage[]>;
}
