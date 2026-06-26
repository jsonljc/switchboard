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
 * Meta CAPI `action_source` values.
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event#action-source
 */
export const ActionSourceSchema = z.enum([
  "website",
  "business_messaging",
  "system_generated",
  "crm",
  "physical_store",
  "app",
  "chat",
  "email",
  "phone_call",
  "other",
]);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

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

  /**
   * Economic value in MINOR currency units (cents), consistent with
   * Opportunity.estimatedValue, LifecycleRevenueEvent.amount, and the
   * funnel revenue sums (funnelByOrg `_sum: { value }`). Converted to MAJOR
   * units ONLY at the Meta CAPI boundary via `normalizeConversionValue`.
   */
  value?: number;
  /** ISO-4217 currency code (e.g. "SGD"). Pairs with `value` for CAPI custom_data. */
  currency?: string;

  sourceAdId?: string;
  sourceCampaignId?: string;

  /**
   * The originating agent deployment (Alex / Riley / Mira / ...) that produced
   * this conversion, when one is known at the producer (e.g. the booking tool's
   * trust-bound `ctx.deploymentId`). Persisted onto `ConversionRecord.agentDeploymentId`
   * and read back by the ROI `breakdown=agent` funnel (`funnelByAgent`). Producers
   * with no agent in scope (an inbound Meta lead, a system payment-verification)
   * leave it undefined — honest absence, never an inferred agent.
   */
  agentDeploymentId?: string;

  occurredAt: Date;

  source: string;

  /**
   * Optional explicit override for Meta CAPI `action_source`. When set, the
   * MetaCAPIDispatcher uses this value instead of inferring from attribution
   * shape. Used by callers that know the true source (e.g. CTWA Contacts →
   * "business_messaging", IF Contacts → "system_generated").
   */
  actionSource?: ActionSource;

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
