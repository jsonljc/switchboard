import { SwitchboardBillingClient } from "./billing";

export type SourceType = "tally" | "typeform" | "webflow" | "google-forms" | "generic";

export interface LeadWebhookSummary {
  id: string;
  label: string;
  tokenPrefix: string;
  sourceType: SourceType;
  greetingTemplateName: string;
  status: "active" | "revoked";
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface LeadWebhookCreated extends LeadWebhookSummary {
  token: string;
  url: string;
}

export class SwitchboardLeadWebhooksClient extends SwitchboardBillingClient {
  async listLeadWebhooks(): Promise<LeadWebhookSummary[]> {
    const data = await this.request<{ webhooks: LeadWebhookSummary[] }>("/api/lead-webhooks");
    return data.webhooks;
  }

  async createLeadWebhook(input: {
    label: string;
    sourceType: SourceType;
    greetingTemplateName?: string;
  }): Promise<LeadWebhookCreated> {
    return this.request<LeadWebhookCreated>("/api/lead-webhooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async revokeLeadWebhook(id: string): Promise<void> {
    await this.request<Record<string, never>>(`/api/lead-webhooks/${id}/revoke`, {
      method: "POST",
    });
  }
}
