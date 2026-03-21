// ---------------------------------------------------------------------------
// Outcome Pipeline — Store interfaces
// ---------------------------------------------------------------------------

import type { OutcomeEvent, ResponseVariantLog } from "@switchboard/schemas";

export interface OutcomeStore {
  saveEvent(event: OutcomeEvent): Promise<void>;
  saveVariantLog(log: ResponseVariantLog): Promise<void>;
  listEvents(filters: {
    organizationId: string;
    since?: Date;
    outcomeType?: string;
  }): Promise<OutcomeEvent[]>;
  listVariantLogs(filters: {
    organizationId: string;
    primaryMove?: string;
    since?: Date;
  }): Promise<ResponseVariantLog[]>;
  updateVariantReply(logId: string, received: boolean, positive: boolean): Promise<void>;
}

export interface OptimisationProposal {
  id: string;
  organizationId: string;
  type: "timing" | "content" | "ordering" | "template";
  description: string;
  currentValue: string;
  proposedValue: string;
  confidence: number;
  sampleSize: number;
  status: "pending" | "approved" | "rejected" | "auto_applied";
  createdAt: Date;
}
