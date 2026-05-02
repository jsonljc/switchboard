import type { AuditEntry, Policy } from "@switchboard/schemas";
import type { PendingApproval, ApprovalDetail, SimulateResult } from "../api-client-types";
import { SwitchboardClientCore } from "./core";

export class SwitchboardGovernanceClient extends SwitchboardClientCore {
  // Approvals
  async listPendingApprovals() {
    return this.request<{ approvals: PendingApproval[] }>("/api/approvals/pending");
  }

  async getApproval(id: string) {
    return this.request<ApprovalDetail>(`/api/approvals/${id}`);
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
}
