/**
 * API-backed governance adapter for MCP server.
 * Provides proxy objects for orchestrator, governance profile store,
 * audit ledger, and storage that delegate to the Switchboard API.
 */
import type { McpApiClient } from "../api-client.js";
import type { GovernanceProfile, GovernanceProfileConfig } from "@switchboard/schemas";

// ── Minimal interfaces ─────────────────────────────────────────────
// These are satisfied by both concrete in-memory implementations and
// the API proxies below. Using `any` for return types since the tool
// handlers operate on these structurally.

export interface MinimalOrchestrator {
  simulate: (params: any) => Promise<any>;
  requestUndo: (envelopeId: string) => Promise<any>;
  executeApproved: (envelopeId: string) => Promise<any>;
  propose: (params: any) => Promise<any>;
}

export interface MinimalStorage {
  approvals: {
    getById: (id: string) => Promise<any>;
    listPending: (orgId?: string) => Promise<any>;
  };
  envelopes: { getById: (id: string) => Promise<any> };
  cartridges: { get: (id: string) => any; list: () => string[] };
}

export interface MinimalLedger {
  query: (filter: any) => Promise<any>;
}

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
      const d = data as any;
      return { decisionTrace: d.decisionTrace ?? d };
    },

    async requestUndo(envelopeId) {
      const { data } = await client.post(`/api/actions/${envelopeId}/undo`, {});
      return data;
    },

    async executeApproved(envelopeId) {
      const { data } = await client.post(`/api/actions/${envelopeId}/execute`, {});
      return (data as any).result ?? data;
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

      const d = data as any;

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
      async getById(approvalId: string) {
        const { status, data } = await client.get(
          `/api/approvals/${encodeURIComponent(approvalId)}`,
        );
        if (status === 404) return null;
        const d = data as any;
        return {
          request: {
            id: d.id ?? approvalId,
            summary: d.summary ?? "",
            riskCategory: d.riskCategory ?? "low",
            expiresAt: d.expiresAt ? new Date(d.expiresAt) : new Date(),
            respondedBy: d.respondedBy ?? null,
          },
          state: { status: d.status ?? "pending" },
          envelopeId: d.envelopeId ?? "",
          organizationId: d.organizationId ?? null,
        };
      },
      async listPending(organizationId?: string) {
        const path = organizationId
          ? `/api/approvals/pending?organizationId=${encodeURIComponent(organizationId)}`
          : "/api/approvals/pending";
        const { data } = await client.get(path);
        const approvals = (data as any).approvals ?? [];
        return approvals.map((a: any) => ({
          request: {
            id: a.id,
            summary: a.summary ?? "",
            riskCategory: a.riskCategory ?? "low",
            expiresAt: a.expiresAt ? new Date(a.expiresAt) : new Date(),
          },
          state: { status: a.status ?? "pending" },
          envelopeId: a.envelopeId ?? "",
        }));
      },
    },
    envelopes: {
      async getById(envelopeId: string) {
        const { status, data } = await client.get(`/api/actions/${encodeURIComponent(envelopeId)}`);
        if (status === 404) return null;
        return data;
      },
    },
    cartridges: {
      get(_id: string) {
        // Remote cartridges are not directly accessible — return undefined.
        // The MCP tools use cartridge only for searchCampaigns which goes through the read adapter.
        return undefined;
      },
      list() {
        return ["digital-ads", "quant-trading", "payments", "crm"];
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
      return (data as any).profile ?? ("guarded" as GovernanceProfile);
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
      return (data as any).config ?? null;
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
    async query(filter: any) {
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
      return ((data as any).entries ?? []).map((e: any) => ({
        id: e.id,
        eventType: e.eventType,
        timestamp: new Date(e.timestamp),
        actorId: e.actorId,
        entityType: e.entityType,
        entityId: e.entityId,
        riskCategory: e.riskCategory,
        summary: e.summary,
        envelopeId: e.envelopeId,
      }));
    },
  };
}
