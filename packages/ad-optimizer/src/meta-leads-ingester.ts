export interface LeadData {
  leadId: string;
  adId: string;
  formId: string;
  name?: string;
  email?: string;
  phone?: string;
}

interface LeadgenValue {
  leadgen_id: string;
  ad_id: string;
  form_id: string;
  field_data?: LeadFieldData[];
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

interface LeadFieldData {
  name: string;
  values: string[];
}

interface LeadDetailResponse {
  id: string;
  ad_id?: string;
  form_id?: string;
  campaign_id?: string;
  field_data?: LeadFieldData[];
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
      const name = extractFieldValue(value.field_data, "full_name");
      const email = extractFieldValue(value.field_data, "email");
      const phone = extractFieldValue(value.field_data, "phone_number");
      const lead: LeadData = {
        leadId: value.leadgen_id,
        adId: value.ad_id,
        formId: value.form_id,
      };
      if (name !== undefined) lead.name = name;
      if (email !== undefined) lead.email = email;
      if (phone !== undefined) lead.phone = phone;
      leads.push(lead);
    }
  }
  return leads;
}

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export async function fetchLeadDetail(
  leadId: string,
  accessToken: string,
): Promise<LeadDetailResponse> {
  const params = new URLSearchParams({ fields: "id,ad_id,form_id,campaign_id,field_data" });
  const url = `${GRAPH_API_BASE}/${leadId}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch lead ${leadId}: HTTP ${response.status}`);
  }
  return (await response.json()) as LeadDetailResponse;
}

export function extractFieldValue(
  fields: LeadFieldData[] | undefined,
  name: string,
): string | undefined {
  const field = fields?.find((f) => f.name === name);
  return field?.values?.[0];
}
