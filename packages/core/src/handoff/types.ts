// ---------------------------------------------------------------------------
// Human Handoff — Types (re-exports from @switchboard/schemas)
// ---------------------------------------------------------------------------
// Handoff / LeadSnapshot / QualificationSnapshot / ConversationSummary
// were hoisted to @switchboard/schemas per Route Governance Contract v1 §8.3.
// This file keeps the existing import paths working via re-export.
// The `HandoffStore` interface stays here — it's a store contract, not a
// cross-app value type, and lives appropriately in core.
// ---------------------------------------------------------------------------

import type { Handoff, HandoffStatus, HandoffConversationSummary } from "@switchboard/schemas";

export type {
  Handoff,
  HandoffReason,
  HandoffStatus,
  LeadSnapshot,
  QualificationSnapshot,
  HandoffConversationSummary,
} from "@switchboard/schemas";

// Back-compat alias for the renamed inner summary type.
export type ConversationSummary = HandoffConversationSummary;

export interface HandoffStore {
  save(pkg: Handoff): Promise<void>;
  getById(id: string): Promise<Handoff | null>;
  getBySessionId(sessionId: string): Promise<Handoff | null>;
  updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void>;
  listPending(organizationId: string): Promise<Handoff[]>;
}
