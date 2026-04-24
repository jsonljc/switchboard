import { z } from "zod";

export const ConversionStageSchema = z.enum([
  "inquiry",
  "qualified",
  "booked",
  "purchased",
  "completed",
]);
export type ConversionStage = z.infer<typeof ConversionStageSchema>;

/**
 * Conversion event types that flow through the feedback loop.
 * @deprecated Use ConversionStage directly.
 */
export type ConversionEventType = ConversionStage;

export interface ConversionEvent {
  eventId: string;
  type: ConversionStage;
  contactId: string;
  organizationId: string;
  accountId?: string;

  value?: number;
  currency?: string;

  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date;

  source: string;

  sourceContext?: {
    model: "ConversationThread" | "Opportunity" | "Booking" | "LifecycleRevenueEvent";
    id: string;
    transition?: string;
  };

  causationId?: string;
  workTraceId?: string;
  metadata: Record<string, unknown>;

  customer?: {
    email?: string;
    phone?: string;
  };

  attribution?: {
    lead_id?: string;
    fbclid?: string;
    fbclidTimestamp?: Date;
    sourceCampaignId?: string;
    sourceAdSetId?: string;
    sourceAdId?: string;
    eventSourceUrl?: string;
    clientUserAgent?: string;
  };
}

export type ConversionEventHandler = (event: ConversionEvent) => void | Promise<void>;

export interface ConversionBus {
  subscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void;
  unsubscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void;
  emit(event: ConversionEvent): void | Promise<void>;
}
