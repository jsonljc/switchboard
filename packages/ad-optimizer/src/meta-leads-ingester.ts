export interface LeadData {
  leadId: string;
  adId: string;
  formId: string;
  campaignId?: string;
  name?: string;
  email?: string;
  phone?: string;
}

interface FieldData {
  name: string;
  values: string[];
}

interface LeadgenValue {
  leadgen_id: string;
  ad_id: string;
  form_id: string;
  campaign_id?: string;
  field_data?: FieldData[];
}

interface WebhookChange {
  field: string;
  value: LeadgenValue | Record<string, unknown>;
}

interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

interface WebhookPayload {
  entry: WebhookEntry[];
}

export function parseLeadWebhook(payload: unknown): LeadData[] {
  const p = payload as WebhookPayload;
  if (!p?.entry) return [];
  const leads: LeadData[] = [];
  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const value = change.value as LeadgenValue;
      if (!value.leadgen_id) continue;
      const fields = value.field_data ?? [];
      leads.push({
        leadId: value.leadgen_id,
        adId: value.ad_id,
        formId: value.form_id,
        campaignId: value.campaign_id,
        name: findField(fields, "full_name"),
        email: findField(fields, "email"),
        phone: findField(fields, "phone_number"),
      });
    }
  }
  return leads;
}

function findField(fields: FieldData[], name: string): string | undefined {
  const field = fields.find((f) => f.name === name);
  return field?.values?.[0];
}
