import type { ConversionEvent, ConversionStage } from "@switchboard/schemas";

type SourceModel = "ConversationThread" | "Opportunity" | "Booking" | "LifecycleRevenueEvent";

export interface BuildConversionEventParams {
  orgId: string;
  accountId: string;
  type: ConversionStage;
  contact: {
    id: string;
    leadgenId?: string;
    attribution?: {
      fbclid?: string;
      fbclidTimestamp?: Date;
      sourceCampaignId?: string;
      sourceAdSetId?: string;
      sourceAdId?: string;
      eventSourceUrl?: string;
      clientUserAgent?: string;
    };
    email?: string;
    phone?: string;
  };
  occurredAt: Date;
  source: {
    model: SourceModel;
    id: string;
    transition?: string;
  };
  value?: number;
  currency?: string;
}

export function buildConversionEvent(params: BuildConversionEventParams): ConversionEvent {
  const { orgId, accountId, type, contact, occurredAt, source, value, currency } = params;
  const transition = source.transition ?? "default";

  const attribution: ConversionEvent["attribution"] = {
    ...(contact.attribution ?? {}),
    ...(contact.leadgenId ? { lead_id: contact.leadgenId } : {}),
  };

  const hasAttribution = Object.keys(attribution).length > 0;

  return {
    eventId: `${orgId}:${accountId}:${source.model}:${source.id}:${type}:${transition}`,
    type,
    contactId: contact.id,
    organizationId: orgId,
    accountId,
    occurredAt,
    source: source.model,
    sourceContext: {
      model: source.model,
      id: source.id,
      transition: source.transition,
    },
    value,
    currency,
    customer:
      contact.email || contact.phone ? { email: contact.email, phone: contact.phone } : undefined,
    attribution: hasAttribution ? attribution : undefined,
    metadata: {},
  };
}
