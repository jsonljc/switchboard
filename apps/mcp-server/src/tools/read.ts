import type { LifecycleOrchestrator, CartridgeReadAdapter, StorageContext } from "@switchboard/core";
import { inferCartridgeId } from "@switchboard/core";
import {
  GetCampaignInputSchema,
  SearchCampaignsInputSchema,
  SimulateActionInputSchema,
  GetApprovalStatusInputSchema,
  ListPendingApprovalsInputSchema,
  GetActionStatusInputSchema,
} from "@switchboard/schemas";
import type { McpAuthContext } from "../auth.js";
import type { SessionGuard } from "../session-guard.js";
import type { ToolDefinition } from "./side-effect.js";

export const readToolDefinitions: ToolDefinition[] = [
  {
    name: "get_campaign",
    description:
      "Get details about a specific ad campaign including status, budget, " +
      "delivery status, and objective.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign ID to look up" },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "search_campaigns",
    description: "Search for campaigns by name or other criteria.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        limit: { type: "number", description: "Max results to return (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "simulate_action",
    description:
      "Dry-run an action through the governance pipeline without executing it. " +
      "Returns the decision, risk score, risk category, and whether approval " +
      "would be required.",
    inputSchema: {
      type: "object",
      properties: {
        actionType: { type: "string", description: "Action type (e.g. ads.campaign.pause)" },
        parameters: {
          type: "object",
          description: "Action parameters",
          additionalProperties: true,
        },
      },
      required: ["actionType", "parameters"],
    },
  },
  {
    name: "get_approval_status",
    description: "Check the status of a pending approval request.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string", description: "The approval request ID" },
      },
      required: ["approvalId"],
    },
  },
  {
    name: "list_pending_approvals",
    description: "List all pending approval requests for the current organization.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results to return (default: 20)" },
      },
    },
  },
  {
    name: "get_action_status",
    description:
      "Get the status of a previously submitted action by its envelope ID. " +
      "Returns status, action type, risk category, and decision trace.",
    inputSchema: {
      type: "object",
      properties: {
        envelopeId: { type: "string", description: "The envelope ID" },
      },
      required: ["envelopeId"],
    },
  },
  {
    name: "get_session_status",
    description:
      "Get current session metrics: call count, mutation count, dollar exposure, " +
      "limits, and whether forced escalation is active.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

export interface ReadToolDeps {
  readAdapter: CartridgeReadAdapter;
  orchestrator: LifecycleOrchestrator;
  storage: StorageContext;
  sessionGuard?: SessionGuard;
}

export async function handleReadTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  deps: ReadToolDeps,
): Promise<unknown> {
  switch (toolName) {
    case "get_campaign": {
      const parsed = GetCampaignInputSchema.parse(args);
      const result = await deps.readAdapter.query({
        cartridgeId: "ads-spend",
        operation: "getCampaign",
        parameters: { campaignId: parsed.campaignId },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }

    case "search_campaigns": {
      const parsed = SearchCampaignsInputSchema.parse(args);
      const result = await deps.readAdapter.query({
        cartridgeId: "ads-spend",
        operation: "searchCampaigns",
        parameters: { query: parsed.query, limit: parsed.limit },
        actorId: auth.actorId,
        organizationId: auth.organizationId,
      });
      return result;
    }

    case "simulate_action": {
      const parsed = SimulateActionInputSchema.parse(args);
      const cartridgeId = inferCartridgeId(
        parsed.actionType,
        deps.storage.cartridges,
      );
      if (!cartridgeId) {
        throw new Error(
          `Cannot infer cartridgeId from actionType: ${parsed.actionType}`,
        );
      }
      const result = await deps.orchestrator.simulate({
        actionType: parsed.actionType,
        parameters: parsed.parameters,
        principalId: auth.actorId,
        cartridgeId,
      });
      return {
        decision: result.decisionTrace.finalDecision,
        riskScore: result.decisionTrace.computedRiskScore.rawScore,
        riskCategory: result.decisionTrace.computedRiskScore.category,
        approvalRequired: result.decisionTrace.approvalRequired,
        trace: result.decisionTrace,
      };
    }

    case "get_approval_status": {
      const parsed = GetApprovalStatusInputSchema.parse(args);
      const approval = await deps.storage.approvals.getById(parsed.approvalId);
      if (!approval) {
        throw new Error(`Approval not found: ${parsed.approvalId}`);
      }
      // Org filter: only allow access if approval belongs to the same org
      if (auth.organizationId && approval.organizationId !== auth.organizationId) {
        throw new Error(`Approval not found: ${parsed.approvalId}`);
      }
      return {
        id: approval.request.id,
        summary: approval.request.summary,
        status: approval.state.status,
        riskCategory: approval.request.riskCategory,
        expiresAt: approval.request.expiresAt,
        respondedBy: approval.request.respondedBy,
        envelopeId: approval.envelopeId,
      };
    }

    case "list_pending_approvals": {
      const parsed = ListPendingApprovalsInputSchema.parse(args);
      const pending = await deps.storage.approvals.listPending(
        auth.organizationId ?? undefined,
      );
      const limited = pending.slice(0, parsed.limit ?? 20);
      return {
        approvals: limited.map((a) => ({
          id: a.request.id,
          summary: a.request.summary,
          status: a.state.status,
          riskCategory: a.request.riskCategory,
          expiresAt: a.request.expiresAt,
          envelopeId: a.envelopeId,
        })),
      };
    }

    case "get_action_status": {
      const parsed = GetActionStatusInputSchema.parse(args);
      const envelope = await deps.storage.envelopes.getById(parsed.envelopeId);
      if (!envelope) {
        throw new Error(`Envelope not found: ${parsed.envelopeId}`);
      }
      const decision = envelope.decisions[0];
      // Detect auto-approval: approval was required but no approval requests were created and envelope executed
      let governanceNote: string | undefined;
      if (
        decision &&
        decision.approvalRequired !== "none" &&
        envelope.approvalRequests.length === 0 &&
        envelope.status === "executed"
      ) {
        governanceNote =
          "Auto-approved: full governance evaluation ran but approval requirement was bypassed (observe mode or emergency override).";
      }
      return {
        id: envelope.id,
        status: envelope.status,
        actionType: envelope.proposals[0]?.actionType,
        riskCategory: decision?.computedRiskScore.category,
        decisionTrace: decision,
        createdAt: envelope.createdAt,
        governanceNote,
      };
    }

    case "get_session_status": {
      if (!deps.sessionGuard) {
        return { error: "Session guard not configured" };
      }
      return deps.sessionGuard.getStatus();
    }

    default:
      throw new Error(`Unknown read tool: ${toolName}`);
  }
}
