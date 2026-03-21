// ---------------------------------------------------------------------------
// Deal Stage Events — emits ConversionBus events on CRM deal transitions
// ---------------------------------------------------------------------------

import type { ConversionBus } from "@switchboard/core";

const STAGE_EVENT_MAP: Record<string, "purchased" | "completed"> = {
  appointment_attended: "purchased",
  treatment_paid: "completed",
  closed_won: "completed",
};

interface DealData {
  contactId: string;
  organizationId: string;
  amount: number | null;
  stage: string;
}

interface ContactAttribution {
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
}

export function emitDealStageEvent(
  bus: ConversionBus,
  deal: DealData,
  contact: ContactAttribution | null,
): void {
  const eventType = STAGE_EVENT_MAP[deal.stage];
  if (!eventType) return;

  bus.emit({
    type: eventType,
    contactId: deal.contactId,
    organizationId: deal.organizationId,
    value: deal.amount ?? 0,
    sourceAdId: contact?.sourceAdId ?? undefined,
    sourceCampaignId: contact?.sourceCampaignId ?? undefined,
    timestamp: new Date(),
    metadata: { stage: deal.stage },
  });
}
