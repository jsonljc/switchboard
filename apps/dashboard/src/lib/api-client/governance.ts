import type { AuditEntry, Policy, ActivityRow } from "@switchboard/schemas";
import type {
  PendingApproval,
  SimulateResult,
  RecommendationApiRow,
  RecommendationActAction,
} from "../api-client-types";
import type {
  GreetingViewModel,
  MetricsViewModel,
  PipelineViewModel,
  WinsViewModel,
} from "@/lib/agent-home/types";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import { createIdempotencyKey } from "@/lib/idempotency";
import { SwitchboardClientCore } from "./core";

export class SwitchboardGovernanceClient extends SwitchboardClientCore {
  // Approvals
  async listPendingApprovals() {
    return this.request<{ approvals: PendingApproval[] }>("/api/approvals/pending");
  }

  async respondToApproval(
    id: string,
    body: { action: string; respondedBy: string; bindingHash: string; patchValue?: unknown },
  ) {
    return this.request<{ envelope: unknown; approvalState: unknown; executionResult: unknown }>(
      `/api/approvals/${id}/respond`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  // Audit
  async queryAudit(params?: {
    eventType?: string;
    limit?: number;
    after?: string;
    before?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.eventType) searchParams.set("eventType", params.eventType);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.after) searchParams.set("after", params.after);
    if (params?.before) searchParams.set("before", params.before);
    const qs = searchParams.toString();
    return this.request<{ entries: AuditEntry[]; total: number }>(
      `/api/audit${qs ? `?${qs}` : ""}`,
    );
  }

  // Policies
  async listPolicies() {
    return this.request<{ policies: Policy[] }>("/api/policies");
  }

  async createPolicy(data: Omit<Policy, "id" | "createdAt" | "updatedAt">) {
    return this.request<{ policy: Policy }>("/api/policies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updatePolicy(id: string, data: Partial<Policy>) {
    return this.request<{ policy: Policy }>(`/api/policies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deletePolicy(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/policies/${id}`, {
      method: "DELETE",
    });
  }

  // Simulate (governance dry-run — legacy)
  async simulate(body: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId?: string;
  }) {
    return this.request<SimulateResult>("/api/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Simulate chat (onboarding TestCenter — real executor with dry-run policy)
  async simulateChat(body: { playbook: unknown; userMessage: string }) {
    return this.request<{
      alexMessage: string;
      annotations: string[];
      toolsAttempted?: Array<{
        toolId: string;
        operation: string;
        simulated: boolean;
        effectCategory: string;
      }>;
      blockedActions?: string[];
    }>("/api/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // DLQ
  async listDlqMessages(status?: string, limit?: number) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return this.request<{ messages: unknown[] }>(`/api/dlq/messages${qs ? `?${qs}` : ""}`);
  }

  async getDlqStats() {
    return this.request<{
      stats: { pending: number; exhausted: number; resolved: number; total: number };
    }>("/api/dlq/stats");
  }

  async retryDlqMessage(id: string) {
    return this.request<{ message: unknown; exhausted: boolean }>(`/api/dlq/messages/${id}/retry`, {
      method: "POST",
    });
  }

  async resolveDlqMessage(id: string) {
    return this.request<{ message: unknown }>(`/api/dlq/messages/${id}/resolve`, {
      method: "POST",
    });
  }

  // Readiness
  async getReadiness(agentId: string) {
    return this.request<{
      ready: boolean;
      checks: Array<{
        id: string;
        label: string;
        status: "pass" | "fail";
        message: string;
        blocking: boolean;
      }>;
    }>(`/api/agents/${agentId}/readiness`);
  }

  // Governance status
  async getGovernanceStatus(orgId: string) {
    return this.request<{
      organizationId: string;
      profile: string;
      posture: string;
      config: unknown;
      deploymentStatus: string;
      haltedAt: string | null;
      haltReason: string | null;
    }>(`/api/governance/${orgId}/status`);
  }

  // Emergency halt
  async emergencyHalt(body: { organizationId?: string; reason?: string }) {
    return this.request<{
      governanceProfile: string;
      organizationId: string;
      deploymentsPaused: number;
      reason: string | null;
    }>("/api/governance/emergency-halt", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Resume
  async resume(body: { organizationId?: string }) {
    return this.request<{
      resumed: boolean;
      profile?: string;
      readiness?: {
        ready: boolean;
        checks: Array<{
          id: string;
          label: string;
          status: "pass" | "fail";
          message: string;
          blocking: boolean;
        }>;
      };
    }>("/api/governance/resume", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Raw passthrough variant of resume.
   *
   * The base `request()` helper throws on any non-ok status, collapsing the
   * upstream API's 400 readiness-blocker body (which carries structured
   * `readiness.checks` data) into a generic `Error("API error: 400")`. The
   * dashboard proxy at `/api/dashboard/governance/resume` needs to forward the
   * 400 body verbatim so the `useResume` hook can surface readable blocker
   * messages to the operator instead of a generic error string.
   *
   * Returns `{ status, body }` for any HTTP response. Only network/transport
   * errors (or response.json() failures) escape as thrown errors. Auth/server
   * errors arrive as a non-200 status with an error-shaped body and the proxy
   * decides how to surface them.
   *
   * Mirrors `replyToEscalationRaw`; the throw-on-non-ok `resume()` variant
   * remains in place for any existing callers.
   */
  async resumeRaw(body: { organizationId?: string }): Promise<{ status: number; body: unknown }> {
    const url = `${this.baseUrl}/api/governance/resume`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const responseBody: unknown = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  }

  // Escalations
  async listEscalations(status = "pending") {
    return this.request<{ escalations: unknown[] }>(`/api/escalations?status=${status}`);
  }

  async getEscalation(id: string) {
    return this.request<{ escalation: unknown; conversationHistory: unknown[] }>(
      `/api/escalations/${id}`,
    );
  }

  async replyToEscalation(id: string, message: string) {
    return this.request<{ escalation: unknown; replySent: boolean }>(
      `/api/escalations/${id}/reply`,
      { method: "POST", body: JSON.stringify({ message }) },
    );
  }

  /**
   * Raw passthrough variant of replyToEscalation.
   *
   * The base `request()` helper throws on any non-ok status, which collapses
   * the upstream API's two distinct success-shapes (200 ok + 502 saved-but-
   * delivery-failed) into a single thrown error. The dashboard proxy at
   * `/api/dashboard/escalations/:id/reply` needs to preserve the 502 body
   * verbatim so the `useEscalationReply` hook can branch UI between truthful
   * success and channel-delivery-failure copy (DC-23).
   *
   * Returns `{ status, body }` for any HTTP response. Only network/transport
   * errors (or response.json() failures) escape as thrown. Auth/server
   * errors arrive here as a non-200 status with an error-shaped body and
   * the proxy can decide how to surface them.
   *
   * Sibling to `replyToEscalation`; the throw-on-non-ok variant remains for
   * other callers that already depend on its semantics.
   */
  async replyToEscalationRaw(
    id: string,
    message: string,
  ): Promise<{ status: number; body: unknown }> {
    const url = `${this.baseUrl}/api/escalations/${id}/reply`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ message }),
    });
    const body: unknown = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async resolveEscalation(id: string, resolutionNote?: string) {
    return this.request<{ escalation: unknown }>(`/api/escalations/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolutionNote }),
    });
  }

  // Recommendations
  async listRecommendations(opts: {
    surface: "queue" | "shadow_action";
    status?: string;
    since?: string;
  }): Promise<{ recommendations: RecommendationApiRow[] }> {
    const params = new URLSearchParams({ surface: opts.surface });
    if (opts.status) params.set("status", opts.status);
    if (opts.since) params.set("since", opts.since);
    return this.request<{ recommendations: RecommendationApiRow[] }>(
      `/api/recommendations?${params.toString()}`,
    );
  }

  // Wins (Slice B agent-home wins feed)
  /**
   * Reads the Wins feed for a given agent and time window.
   * Slice B endpoint: GET /api/dashboard/agents/:agentKey/wins?window=…
   *
   * Returns the wire shape unchanged — `vm` contains the wins view-model.
   */
  async listWins(
    agentKey: string,
    window: "today" | "week" | "month" = "today",
  ): Promise<{ vm: WinsViewModel }> {
    const path = `/api/dashboard/agents/${encodeURIComponent(agentKey)}/wins?window=${window}`;
    return this.request<{ vm: WinsViewModel }>(path);
  }

  // Pipeline (Slice B agent-home pipeline block)
  /**
   * Reads the Pipeline block for a given agent.
   * Slice B endpoint: GET /api/dashboard/agents/:agentKey/pipeline
   *
   * Returns the wire shape unchanged — `vm` contains the pipeline view-model.
   */
  async listPipeline(agentKey: string): Promise<{ vm: PipelineViewModel }> {
    const path = `/api/dashboard/agents/${encodeURIComponent(agentKey)}/pipeline`;
    return this.request<{ vm: PipelineViewModel }>(path);
  }

  // Metrics (Slice B agent-home metrics block — PR-S5)
  /**
   * Reads the Metrics block for a given agent.
   * Slice B endpoint: GET /api/dashboard/agents/:agentKey/metrics?window=week
   *
   * PR-S5 ships window=week only; the parameter is kept on the type for future
   * extension. Returns the wire shape unchanged — `vm` contains the metrics
   * view-model.
   */
  async listMetrics(agentKey: string, window: "week" = "week"): Promise<{ vm: MetricsViewModel }> {
    const path = `/api/dashboard/agents/${encodeURIComponent(agentKey)}/metrics?window=${window}`;
    return this.request<{ vm: MetricsViewModel }>(path);
  }

  // Decisions (cross-kind feed: recommendations + handoffs)
  /**
   * Reads the Decision Feed (Slice A PR 3 endpoint). Pass an `agentKey` to
   * scope to one agent; omit for the cross-agent inbox feed.
   *
   * Returns the wire shape unchanged — `createdAt` and `meta.slaDeadlineAt` /
   * `meta.undoableUntil` are ISO strings (the API serializes Date → string).
   */
  async listDecisions(agentKey?: string): Promise<{
    decisions: unknown[];
    counts: { total: number; approval: number; handoff: number };
  }> {
    const path = agentKey
      ? `/api/dashboard/agents/${encodeURIComponent(agentKey)}/decisions`
      : `/api/dashboard/decisions`;
    return this.request<{
      decisions: unknown[];
      counts: { total: number; approval: number; handoff: number };
    }>(path);
  }

  async getGreeting(agentKey: string): Promise<{ data: GreetingViewModel }> {
    return this.request<{ data: GreetingViewModel }>(
      `/api/dashboard/agents/${encodeURIComponent(agentKey)}/greeting`,
    );
  }

  async getMission(agentKey: string): Promise<MissionAggregatorResponse> {
    return this.request<MissionAggregatorResponse>(
      `/api/dashboard/agents/${encodeURIComponent(agentKey)}/mission`,
    );
  }

  async getAgentActivityCockpit(
    agentKey: string,
    opts: { limit?: number; expandPreview?: boolean } = {},
  ): Promise<{ rows: ActivityRow[] }> {
    const qs = new URLSearchParams();
    if (typeof opts.limit === "number") qs.set("limit", String(opts.limit));
    if (opts.expandPreview === false) qs.set("expandPreview", "false");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<{ rows: ActivityRow[] }>(
      `/api/dashboard/agents/${encodeURIComponent(agentKey)}/activity${suffix}`,
    );
  }

  /**
   * Bypasses request<T>() because that helper throws on non-2xx without
   * surfacing the status code. The dashboard proxy needs the raw 409 to
   * propagate so the frontend hook can swallow already-terminal as success.
   */
  async actOnRecommendation(
    id: string,
    body: { action: RecommendationActAction; note?: string },
  ): Promise<{ status: number; body: unknown }> {
    // Validate id is a UUID — defends against SSRF / path traversal via caller-controlled URL segment.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`Invalid recommendation id: ${id}`);
    }
    const res = await fetch(`${this.baseUrl}/api/recommendations/${encodeURIComponent(id)}/act`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "Idempotency-Key": createIdempotencyKey(),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
}
