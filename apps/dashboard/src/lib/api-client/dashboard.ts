import type {
  Playbook,
  ScanResult,
  OperatorOverview,
  ContactsListResponse,
  ContactDetailResponse,
  ScheduledTriggersListResponse,
  AuditEntriesListResponse,
  ReportDataV1,
  ReportWindow,
  PipelineBoardResponse,
  PipelineBoardOpportunity,
  OpportunityStage,
  PaidVisitRow,
  ReconcileBookingActionBody,
  HomeSummary,
} from "@switchboard/schemas";
import { HomeSummarySchema } from "@switchboard/schemas";
import { createIdempotencyKey } from "@/lib/idempotency";
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

  async getDashboardOverview(orgId: string): Promise<OperatorOverview> {
    return this.request<OperatorOverview>(`/api/${orgId}/dashboard/overview`);
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

  async recordAttendance(
    orgId: string,
    bookingId: string,
    body: { outcome: "attended" | "no_show"; recordedBy?: "owner" | "staff" },
    idempotencyKey: string,
  ) {
    return this.request(`/api/${orgId}/bookings/${bookingId}/attendance`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  async reconcileBooking(
    orgId: string,
    bookingId: string,
    body: ReconcileBookingActionBody,
    idempotencyKey: string,
  ) {
    return this.request(`/api/${orgId}/bookings/${bookingId}/reconcile`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
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

  async getPaidVisitsByCampaign(
    orgId: string,
    params: { from: string; to: string },
  ): Promise<{ paidVisits: PaidVisitRow[] }> {
    const search = new URLSearchParams({
      detail: "paid-visits",
      from: params.from,
      to: params.to,
    });
    return this.request<{ paidVisits: PaidVisitRow[] }>(
      `/api/${orgId}/revenue/by-campaign?${search.toString()}`,
    );
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

  // ── Reports (Mercury /reports) ──

  async getReport(window: ReportWindow): Promise<ReportDataV1> {
    const params = new URLSearchParams({ window });
    return this.request<ReportDataV1>(`/api/dashboard/reports?${params.toString()}`);
  }

  async refreshReport(window: ReportWindow): Promise<ReportDataV1> {
    const params = new URLSearchParams({ window });
    return this.request<ReportDataV1>(`/api/dashboard/reports/refresh?${params.toString()}`, {
      method: "POST",
    });
  }

  async getHomeSummary(): Promise<HomeSummary> {
    const raw = await this.request<{ summary: unknown }>("/api/dashboard/home/summary");
    return HomeSummarySchema.parse(raw.summary);
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

  // ── Lifecycle: Disqualifications (Phase 3b) ──

  async listPendingDisqualifications(): Promise<{ items: unknown[] }> {
    return this.request("/api/dashboard/lifecycle/disqualifications/pending");
  }

  /**
   * Confirm or dismiss a proposed disqualification. Uses raw fetch so that
   * 409 (already-resolved / state conflict) and 404 (not found) survive back
   * to the proxy without being collapsed into a generic 500.
   */
  async resolveDisqualification(
    threadId: string,
    action: "confirm" | "dismiss",
    body: { operatorNote?: string },
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(
      `${this.baseUrl}/api/dashboard/lifecycle/disqualifications/${encodeURIComponent(threadId)}/${action}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify(body),
      },
    );
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  // ── Pipeline Board (Mercury /contacts pipeline) ──

  async getOpportunitiesBoard(): Promise<PipelineBoardResponse> {
    return this.request<PipelineBoardResponse>("/api/dashboard/opportunities");
  }

  /**
   * Move an opportunity to a new stage. Uses raw fetch so that 404 (unknown id)
   * and 400 (invalid stage) survive back to the dashboard proxy with status-
   * annotated errors — matching the pattern used by `getContact`.
   */
  async patchOpportunityStage(
    id: string,
    stage: OpportunityStage,
  ): Promise<{ opportunity: PipelineBoardOpportunity }> {
    const url = `${this.baseUrl}/api/dashboard/opportunities/${encodeURIComponent(id)}/stage`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "Idempotency-Key": createIdempotencyKey(),
      },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const err = new Error(
        res.status === 404
          ? "not found"
          : res.status === 400
            ? "invalid stage"
            : body.error || `API error: ${res.status}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return res.json() as Promise<{ opportunity: PipelineBoardOpportunity }>;
  }
}
