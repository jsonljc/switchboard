/**
 * API-backed governance adapter for MCP server.
 * Provides proxy objects for orchestrator, governance profile store,
 * audit ledger, and storage that delegate to the Switchboard API.
 */
import type { McpApiClient } from "../api-client.js";
import type { GovernanceProfile, GovernanceProfileConfig } from "@switchboard/schemas";
import type {
  MinimalOrchestrator,
  MinimalStorage,
  MinimalLedger,
  MinimalApprovalRecord,
  MinimalEnvelopeRecord,
  MinimalAuditEntry,
} from "../server.js";

// ── API-backed implementations ──────────────────────────────────────

export function createApiOrchestrator(client: McpApiClient): MinimalOrchestrator {
  return {
    async simulate(params) {
      const { data } = await client.post("/api/simulate", {
        actionType: params.actionType,
        parameters: params.parameters,
        actorId: params.principalId,
        cartridgeId: params.cartridgeId,
      });
      const d = data as Record<string, unknown>;
      return {
        decisionTrace: (d.decisionTrace ?? d) as {
          finalDecision: string;
          computedRiskScore: { rawScore: number; category: string };
          approvalRequired: string;
        },
      };
    },

    async requestUndo(envelopeId) {
      const { data } = await client.post(`/api/actions/${envelopeId}/undo`, {});
      return data as {
        denied: boolean;
        envelope: { id: string };
        explanation?: string;
        approvalRequest?: { id: string; summary: string } | null;
      };
    },

    async executeApproved(envelopeId) {
      const { data } = await client.post(`/api/actions/${envelopeId}/execute`, {});
      const d = data as Record<string, unknown>;
      return ((d.result as { summary?: string; success?: boolean }) ?? data) as {
        summary?: string;
        success?: boolean;
      };
    },

    async propose(params) {
      const { data } = await client.post(
        "/api/execute",
        {
          actorId: params.principalId,
          organizationId: params.organizationId ?? null,
          action: {
            actionType: params.actionType,
            parameters: params.parameters,
            sideEffect: true,
          },
          message: params.message,
          emergencyOverride: params.emergencyOverride ?? false,
        },
        client.idempotencyKey("mcp_propose"),
      );

      const d = data as {
        envelopeId: string;
        outcome: string;
        approvalRequest?: { id: string; summary: string } | null;
        deniedExplanation?: string;
        traceId?: string;
      };

      const envelope = {
        id: d.envelopeId,
        version: 1,
        incomingMessage: null,
        conversationId: null,
        proposals: [
          {
            id: d.envelopeId,
            actionType: params.actionType,
            parameters: params.parameters,
            status: d.outcome === "DENIED" ? "denied" : "proposed",
          },
        ],
        resolvedEntities: [],
        plan: null,
        decisions: [],
        approvalRequests: d.approvalRequest ? [d.approvalRequest] : [],
        executionResults: [],
        auditEntryIds: [],
        status:
          d.outcome === "DENIED"
            ? "denied"
            : d.outcome === "PENDING_APPROVAL"
              ? "pending_approval"
              : "approved",
        createdAt: new Date(),
        updatedAt: new Date(),
        parentEnvelopeId: null,
        traceId: d.traceId ?? d.envelopeId,
      };

      const decisionTrace = {
        actionId: d.envelopeId,
        envelopeId: d.envelopeId,
        checks: [],
        computedRiskScore: { rawScore: 0, category: "low", factors: [] },
        finalDecision: d.outcome === "DENIED" ? "deny" : "allow",
        approvalRequired: d.approvalRequest ? "standard" : "none",
        explanation: d.deniedExplanation ?? "",
        evaluatedAt: new Date(),
      };

      return {
        envelope,
        decisionTrace,
        approvalRequest: d.approvalRequest ?? null,
        denied: d.outcome === "DENIED",
        explanation: d.deniedExplanation ?? "",
      };
    },
  };
}

export function createApiStorage(client: McpApiClient): MinimalStorage {
  return {
    approvals: {
      async getById(approvalId: string): Promise<MinimalApprovalRecord | null> {
        const { status, data } = await client.get(
          `/api/approvals/${encodeURIComponent(approvalId)}`,
        );
        if (status === 404) return null;
        const d = data as Record<string, unknown>;
        return {
          request: {
            id: (d.id as string) ?? approvalId,
            summary: (d.summary as string) ?? "",
            riskCategory: (d.riskCategory as string) ?? "low",
            expiresAt: d.expiresAt ? new Date(d.expiresAt as string) : new Date(),
            respondedBy: (d.respondedBy as string) ?? null,
          },
          state: { status: (d.status as string) ?? "pending" },
          envelopeId: (d.envelopeId as string) ?? "",
          organizationId: (d.organizationId as string) ?? null,
        };
      },
      async listPending(organizationId?: string): Promise<MinimalApprovalRecord[]> {
        const path = organizationId
          ? `/api/approvals/pending?organizationId=${encodeURIComponent(organizationId)}`
          : "/api/approvals/pending";
        const { data } = await client.get(path);
        const d = data as { approvals?: Array<Record<string, unknown>> };
        const approvals = d.approvals ?? [];
        return approvals.map((a) => ({
          request: {
            id: a.id as string,
            summary: (a.summary as string) ?? "",
            riskCategory: (a.riskCategory as string) ?? "low",
            expiresAt: a.expiresAt ? new Date(a.expiresAt as string) : new Date(),
          },
          state: { status: (a.status as string) ?? "pending" },
          envelopeId: (a.envelopeId as string) ?? "",
        }));
      },
    },
    envelopes: {
      async getById(envelopeId: string): Promise<MinimalEnvelopeRecord | null> {
        const { status, data } = await client.get(`/api/actions/${encodeURIComponent(envelopeId)}`);
        if (status === 404) return null;
        return data as MinimalEnvelopeRecord;
      },
    },
    cartridges: {
      get(_id: string) {
        // Remote cartridges are not directly accessible — return undefined.
        // The MCP tools use cartridge only for searchCampaigns which goes through the read adapter.
        return undefined;
      },
      list() {
        return ["digital-ads", "payments", "crm", "customer-engagement"];
      },
    },
  };
}

export function createApiGovernanceProfileStore(client: McpApiClient) {
  return {
    async get(organizationId: string | null): Promise<GovernanceProfile> {
      if (!organizationId) return "guarded" as GovernanceProfile;
      const { data } = await client.get(
        `/api/governance/${encodeURIComponent(organizationId)}/status`,
      );
      return (
        ((data as Record<string, unknown>).profile as GovernanceProfile) ??
        ("guarded" as GovernanceProfile)
      );
    },
    async set(organizationId: string | null, profile: GovernanceProfile): Promise<void> {
      if (!organizationId) return;
      await client.put(`/api/governance/${encodeURIComponent(organizationId)}/profile`, {
        profile,
      });
    },
    async getConfig(organizationId: string | null): Promise<GovernanceProfileConfig | null> {
      if (!organizationId) return null;
      const { data } = await client.get(
        `/api/governance/${encodeURIComponent(organizationId)}/status`,
      );
      return ((data as Record<string, unknown>).config as GovernanceProfileConfig) ?? null;
    },
    async setConfig(organizationId: string | null, config: GovernanceProfileConfig): Promise<void> {
      if (!organizationId) return;
      await client.put(`/api/governance/${encodeURIComponent(organizationId)}/profile`, {
        profile: config.profile,
      });
    },
  };
}

export function createApiLedger(client: McpApiClient): MinimalLedger {
  return {
    async query(filter) {
      const params = new URLSearchParams();
      if (filter.envelopeId) params.set("envelopeId", filter.envelopeId);
      if (filter.entityId) params.set("entityId", filter.entityId);
      if (filter.eventType) params.set("eventType", filter.eventType);
      if (filter.organizationId) params.set("organizationId", filter.organizationId);
      if (filter.after)
        params.set(
          "after",
          filter.after instanceof Date ? filter.after.toISOString() : filter.after,
        );
      if (filter.before)
        params.set(
          "before",
          filter.before instanceof Date ? filter.before.toISOString() : filter.before,
        );
      if (filter.limit) params.set("limit", String(filter.limit));

      const { data } = await client.get(`/api/audit?${params.toString()}`);
      const d = data as { entries?: Array<Record<string, unknown>> };
      return (d.entries ?? []).map(
        (e): MinimalAuditEntry => ({
          id: e.id as string,
          eventType: e.eventType as string,
          timestamp: new Date(e.timestamp as string),
          actorId: e.actorId as string,
          entityType: e.entityType as string,
          entityId: e.entityId as string,
          riskCategory: e.riskCategory as string | undefined,
          summary: e.summary as string | undefined,
          envelopeId: e.envelopeId as string | undefined,
        }),
      );
    },
  };
}
