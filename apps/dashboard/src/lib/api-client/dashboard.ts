import type {
  Playbook,
  ScanResult,
  DashboardOverview,
  ContactsListResponse,
  ContactDetailResponse,
  ScheduledTriggersListResponse,
  AuditEntriesListResponse,
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

  // ── Activity (Mercury /activity browse) ──

  async getActivity(query: {
    scope?: "operational" | "all";
    cursor?: string;
    limit?: number;
    eventType?: string;
    actorType?: string;
    entityType?: string;
    entityId?: string;
    after?: string;
    before?: string;
  }): Promise<AuditEntriesListResponse> {
    const params = new URLSearchParams();
    if (query.scope) params.set("scope", query.scope);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.eventType) params.set("eventType", query.eventType);
    if (query.actorType) params.set("actorType", query.actorType);
    if (query.entityType) params.set("entityType", query.entityType);
    if (query.entityId) params.set("entityId", query.entityId);
    if (query.after) params.set("after", query.after);
    if (query.before) params.set("before", query.before);
    const qs = params.toString();
    return this.request<AuditEntriesListResponse>(`/api/dashboard/activity${qs ? `?${qs}` : ""}`);
  }

  /**
   * Fetch the composite payload for a single contact (D1.5). Uses a dedicated
   * fetch path (not `request`) so the upstream HTTP status (notably 404 for
   * unknown / cross-org contactId) survives back to the dashboard proxy. The
   * shared `request` helper collapses all non-2xx into `Error("…")`, which
   * would force every upstream 404 to surface as 500. The proxy reads `.status`
   * off the thrown Error (annotated with `.status`) to preserve fidelity.
   */
  async getContact(id: string): Promise<ContactDetailResponse> {
    const url = `${this.baseUrl}/api/dashboard/contacts/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const err = new Error(body.error || `API error: ${res.status}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    return res.json() as Promise<ContactDetailResponse>;
  }

  // ── Automations (Mercury /automations list — D2) ──

  async getAutomations(query: {
    status?: string;
    cursor?: string;
    limit?: number;
    sort?: string;
    direction?: string;
  }): Promise<ScheduledTriggersListResponse> {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.sort) params.set("sort", query.sort);
    if (query.direction) params.set("direction", query.direction);
    const qs = params.toString();
    return this.request(`/api/dashboard/automations${qs ? `?${qs}` : ""}`);
  }
}
