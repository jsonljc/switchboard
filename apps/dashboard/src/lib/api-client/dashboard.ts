import type {
  Playbook,
  ScanResult,
  DashboardOverview,
  ContactsListResponse,
} from "@switchboard/schemas";
import { SwitchboardAgentsClient } from "./agents";

export class SwitchboardDashboardClient extends SwitchboardAgentsClient {
  // ── Playbook ──

  async getPlaybook(): Promise<{ playbook: Playbook; step: number; complete: boolean }> {
    return this.request("/api/playbook");
  }

  async updatePlaybook(body: {
    playbook?: Playbook;
    step?: number;
  }): Promise<{ playbook: Playbook; step: number }> {
    return this.request("/api/playbook", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  // ── Website Scan ──

  async scanWebsite(body: {
    url: string;
    sourceType?: string;
  }): Promise<{ result: ScanResult; error?: string }> {
    return this.request("/api/website-scan", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ── Dashboard ──

  async getDashboardOverview(orgId: string): Promise<DashboardOverview> {
    return this.request<DashboardOverview>(`/api/${orgId}/dashboard/overview`);
  }

  async updateTask(orgId: string, taskId: string, body: Record<string, unknown>) {
    return this.request(`/api/${orgId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async getRoiSummary(orgId: string, params?: { from?: string; to?: string; breakdown?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set("from", params.from);
    if (params?.to) searchParams.set("to", params.to);
    if (params?.breakdown) searchParams.set("breakdown", params.breakdown);
    const qs = searchParams.toString();
    return this.request(`/api/${orgId}/roi/summary${qs ? `?${qs}` : ""}`);
  }

  async recordRevenue(
    orgId: string,
    body: {
      contactId: string;
      amount: number;
      currency: string;
      type: string;
      recordedBy: string;
      externalReference: string | null;
      sourceCampaignId: string | null;
      sourceAdId: string | null;
    },
  ) {
    return this.request(`/api/${orgId}/revenue`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ── Contacts (Mercury /contacts list) ──

  async getContacts(query: {
    stage?: string;
    search?: string;
    cursor?: string;
    limit?: number;
    sort?: string;
    direction?: string;
  }): Promise<ContactsListResponse> {
    const params = new URLSearchParams();
    if (query.stage) params.set("stage", query.stage);
    if (query.search) params.set("search", query.search);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.sort) params.set("sort", query.sort);
    if (query.direction) params.set("direction", query.direction);
    const qs = params.toString();
    return this.request<ContactsListResponse>(`/api/dashboard/contacts${qs ? `?${qs}` : ""}`);
  }
}
