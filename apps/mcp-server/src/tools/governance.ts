import type {
  LifecycleOrchestrator,
  CartridgeReadAdapter,
  GovernanceProfileStore,
  AuditLedger,
  AuditQueryFilter,
  StorageContext,
} from "@switchboard/core";
import { profileToPosture } from "@switchboard/core";
import type { AuditEventType } from "@switchboard/schemas";
import {
  RequestUndoInputSchema,
  EmergencyHaltInputSchema,
  GetAuditTrailInputSchema,
  GetGovernanceStatusInputSchema,
} from "@switchboard/schemas";
import type { McpAuthContext } from "../auth.js";
import type { ToolDefinition } from "./side-effect.js";

export interface GovernanceToolDeps {
  orchestrator: LifecycleOrchestrator;
  readAdapter: CartridgeReadAdapter;
  governanceProfileStore: GovernanceProfileStore;
  ledger: AuditLedger;
  storage: StorageContext;
}

export const governanceToolDefinitions: ToolDefinition[] = [
  {
    name: "request_undo",
    description:
      "Request undo of a previously executed action. Uses the undo recipe " +
      "stored on the original envelope. Goes through the full governance pipeline " +
      "(the undo itself may require approval). Returns EXECUTED, PENDING_APPROVAL, or DENIED.",
    inputSchema: {
      type: "object",
      properties: {
        envelopeId: { type: "string", description: "The envelope ID of the action to undo" },
      },
      required: ["envelopeId"],
    },
  },
  {
    name: "emergency_halt",
    description:
      "Emergency halt: lock governance profile and pause all active campaigns. " +
      "This is a drastic action — use only when immediate intervention is needed.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Reason for the emergency halt" },
      },
    },
  },
  {
    name: "get_audit_trail",
    description:
      "Query the audit trail. Filter by envelope ID, entity ID, event type, " +
      "date range, or limit the number of results.",
    inputSchema: {
      type: "object",
      properties: {
        envelopeId: { type: "string", description: "Filter by envelope ID" },
        entityId: { type: "string", description: "Filter by entity ID" },
        eventType: { type: "string", description: "Filter by event type (e.g. action.executed)" },
        after: { type: "string", description: "ISO date — only entries after this time" },
        before: { type: "string", description: "ISO date — only entries before this time" },
        limit: { type: "number", description: "Max entries to return (default: 50, max: 200)" },
      },
    },
  },
  {
    name: "get_governance_status",
    description:
      "Get the current governance profile and posture for an organization. " +
      "Returns the profile level (observe/guarded/strict/locked) and derived risk posture.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "Organization ID (default: current org)" },
      },
    },
  },
];

export async function handleGovernanceTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
  deps: GovernanceToolDeps,
): Promise<unknown> {
  switch (toolName) {
    case "request_undo": {
      const parsed = RequestUndoInputSchema.parse(args);
      const result = await deps.orchestrator.requestUndo(parsed.envelopeId);

      if (result.denied) {
        return {
          outcome: "DENIED",
          envelopeId: result.envelope.id,
          explanation: result.explanation,
        };
      }

      if (result.approvalRequest) {
        return {
          outcome: "PENDING_APPROVAL",
          envelopeId: result.envelope.id,
          approvalId: result.approvalRequest.id,
          summary: result.approvalRequest.summary,
        };
      }

      // Auto-approved undo — execute it
      const execResult = await deps.orchestrator.executeApproved(result.envelope.id);
      return {
        outcome: "EXECUTED",
        envelopeId: result.envelope.id,
        summary: execResult.summary,
        success: execResult.success,
      };
    }

    case "emergency_halt": {
      const parsed = EmergencyHaltInputSchema.parse(args);
      const orgId = auth.organizationId ?? null;

      // Lock governance profile
      await deps.governanceProfileStore.set(orgId, "locked");

      // Find and pause all active campaigns
      const paused: string[] = [];
      const failures: Array<{ campaignId: string; error: string }> = [];

      try {
        const cartridge = deps.storage.cartridges.get("ads-spend");
        if (cartridge?.searchCampaigns) {
          const campaigns = await cartridge.searchCampaigns("*");
          for (const campaign of campaigns) {
            if (campaign.status === "ACTIVE") {
              try {
                const proposeResult = await deps.orchestrator.propose({
                  actionType: "ads.campaign.pause",
                  parameters: { campaignId: campaign.id },
                  principalId: auth.actorId,
                  organizationId: orgId,
                  cartridgeId: "ads-spend",
                  message: `Emergency halt: ${parsed.reason ?? "no reason provided"}`,
                  emergencyOverride: true,
                });

                if (!proposeResult.denied) {
                  await deps.orchestrator.executeApproved(proposeResult.envelope.id);
                  paused.push(campaign.id);
                }
              } catch (err) {
                failures.push({
                  campaignId: campaign.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        }
      } catch {
        // Continue — governance profile is already locked
      }

      return {
        governanceProfile: "locked",
        campaignsPaused: paused,
        failures,
        reason: parsed.reason ?? null,
      };
    }

    case "get_audit_trail": {
      const parsed = GetAuditTrailInputSchema.parse(args);
      const filter: AuditQueryFilter = {
        limit: parsed.limit ?? 50,
      };

      if (parsed.envelopeId) filter.envelopeId = parsed.envelopeId;
      if (parsed.entityId) filter.entityId = parsed.entityId;
      if (parsed.eventType) filter.eventType = parsed.eventType as AuditEventType;
      if (parsed.after) filter.after = new Date(parsed.after);
      if (parsed.before) filter.before = new Date(parsed.before);
      if (auth.organizationId) filter.organizationId = auth.organizationId;

      const entries = await deps.ledger.query(filter);
      return {
        entries: entries.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          timestamp: e.timestamp,
          actorId: e.actorId,
          entityType: e.entityType,
          entityId: e.entityId,
          riskCategory: e.riskCategory,
          summary: e.summary,
          envelopeId: e.envelopeId,
        })),
        total: entries.length,
      };
    }

    case "get_governance_status": {
      const parsed = GetGovernanceStatusInputSchema.parse(args);
      const orgId = parsed.organizationId ?? auth.organizationId ?? null;
      const profile = await deps.governanceProfileStore.get(orgId);
      const posture = profileToPosture(profile);

      return {
        organizationId: orgId,
        profile,
        posture,
      };
    }

    default:
      throw new Error(`Unknown governance tool: ${toolName}`);
  }
}
