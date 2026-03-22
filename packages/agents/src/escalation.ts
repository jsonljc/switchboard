export type EscalationReason =
  | "low_confidence"
  | "booking_question"
  | "pricing_exception"
  | "unhappy_lead"
  | "compliance_risk"
  | "high_value_lead"
  | "human_requested"
  | "unsupported_intent";

export type EscalationPriority = "low" | "medium" | "high" | "urgent";
export type EscalationStatus = "open" | "acknowledged" | "snoozed" | "resolved";

export interface EscalateInput {
  orgId: string;
  contactId: string;
  reason: EscalationReason;
  reasonDetails?: string;
  sourceAgent: string;
  priority: EscalationPriority;
  conversationSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface EscalationRecord {
  id: string;
}

export interface EscalationStore {
  create(input: EscalateInput): Promise<EscalationRecord>;
  findOpen(orgId: string, contactId: string, reason: string): Promise<EscalationRecord | null>;
  updateStatus(id: string, status: EscalationStatus): Promise<void>;
}

export interface EscalationNotifier {
  notifyDashboard(record: EscalationRecord, input: EscalateInput): Promise<void>;
  notifyWhatsApp(record: EscalationRecord, input: EscalateInput): Promise<void>;
}

export interface EscalationServiceConfig {
  store: EscalationStore;
  notifier: EscalationNotifier;
}

export interface EscalateResult {
  escalationId: string;
  deduplicated: boolean;
}

export class EscalationService {
  private store: EscalationStore;
  private notifier: EscalationNotifier;

  constructor(config: EscalationServiceConfig) {
    this.store = config.store;
    this.notifier = config.notifier;
  }

  async escalateToOwner(input: EscalateInput): Promise<EscalateResult> {
    // Deduplicate: skip if open escalation exists for same contact+reason
    const existing = await this.store.findOpen(input.orgId, input.contactId, input.reason);
    if (existing) {
      return { escalationId: existing.id, deduplicated: true };
    }

    // 1. Create durable record first (the real record)
    const record = await this.store.create(input);

    // 2. Fan out notifications — failures must not block
    await this.notifier.notifyDashboard(record, input).catch(() => {});

    await this.notifier.notifyWhatsApp(record, input).catch(() => {});

    return { escalationId: record.id, deduplicated: false };
  }
}
