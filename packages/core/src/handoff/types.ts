// ---------------------------------------------------------------------------
// Human Handoff — Types (re-exports from @switchboard/schemas)
// ---------------------------------------------------------------------------
// HandoffPackage / LeadSnapshot / QualificationSnapshot / ConversationSummary
// were hoisted to @switchboard/schemas per Route Governance Contract v1 §8.3.
// This file keeps the existing import paths working via re-export and adds
// the `HandoffPackage` back-compat alias for the renamed `Handoff` type.
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

// Back-compat alias — `HandoffPackage` was the original core name. Existing
// callers (escalations.ts, handoff-store impls) keep importing this until a
// follow-up sweep renames them. PR-4 removes this alias once grep returns 0.
export type HandoffPackage = Handoff;

// Back-compat alias for the renamed inner summary type.
export type ConversationSummary = HandoffConversationSummary;

export interface HandoffStore {
  save(pkg: HandoffPackage): Promise<void>;
  getById(id: string): Promise<HandoffPackage | null>;
  getBySessionId(sessionId: string): Promise<HandoffPackage | null>;
  updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void>;
  listPending(organizationId: string): Promise<HandoffPackage[]>;
}
