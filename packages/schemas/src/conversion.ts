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
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date;
  source: string;
  causationId?: string;
  workTraceId?: string;
  metadata: Record<string, unknown>;
}

export type ConversionEventHandler = (event: ConversionEvent) => void | Promise<void>;

export interface ConversionBus {
  subscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void;
  unsubscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void;
  emit(event: ConversionEvent): void | Promise<void>;
}
