// ---------------------------------------------------------------------------
// Outcome Pipeline — records conversation outcomes and response variants
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { OutcomeEvent, OutcomeType, ResponseVariantLog } from "@switchboard/schemas";
import type { OutcomeStore } from "./types.js";

export class OutcomePipeline {
  constructor(private store: OutcomeStore) {}

  async emitOutcome(params: {
    sessionId: string;
    organizationId: string;
    leadId?: string;
    outcomeType: OutcomeType;
    metadata?: Record<string, unknown>;
  }): Promise<OutcomeEvent> {
    const event: OutcomeEvent = {
      id: `outcome_${randomUUID()}`,
      sessionId: params.sessionId,
      organizationId: params.organizationId,
      leadId: params.leadId,
      outcomeType: params.outcomeType,
      metadata: params.metadata,
      timestamp: new Date(),
    };
    await this.store.saveEvent(event);
    return event;
  }

  async logResponseVariant(params: {
    sessionId: string;
    organizationId: string;
    primaryMove: string;
    templateId?: string;
    responseText: string;
    conversationState?: string;
  }): Promise<ResponseVariantLog> {
    const log: ResponseVariantLog = {
      id: `variant_${randomUUID()}`,
      sessionId: params.sessionId,
      organizationId: params.organizationId,
      primaryMove: params.primaryMove,
      templateId: params.templateId,
      responseText: params.responseText,
      conversationState: params.conversationState,
      timestamp: new Date(),
    };
    await this.store.saveVariantLog(log);
    return log;
  }

  async recordLeadReply(variantLogId: string, received: boolean, positive: boolean): Promise<void> {
    await this.store.updateVariantReply(variantLogId, received, positive);
  }
}
