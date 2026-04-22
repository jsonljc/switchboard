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

  // Simulate
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
}
