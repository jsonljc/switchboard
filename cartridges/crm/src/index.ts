import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
} from "@switchboard/schemas";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import { CRM_MANIFEST } from "./manifest.js";
import type { CrmProvider } from "./providers/crm-provider.js";
import { createCrmProvider } from "./providers/factory.js";
import { DEFAULT_CRM_GUARDRAILS } from "./defaults/guardrails.js";
import {
  computeContactSearchRiskInput,
  computeDealListRiskInput,
  computeActivityListRiskInput,
  computePipelineStatusRiskInput,
  computeContactCreateRiskInput,
  computeContactUpdateRiskInput,
  computeDealCreateRiskInput,
  computeActivityLogRiskInput,
} from "./risk/categories.js";
import {
  buildContactCreateUndoRecipe,
  buildContactUpdateUndoRecipe,
  buildDealCreateUndoRecipe,
} from "./actions/index.js";

export class CrmCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = CRM_MANIFEST;
  private provider: CrmProvider | null = null;

  async initialize(_context: CartridgeContext): Promise<void> {
    this.provider = createCrmProvider();
  }

  getProvider(): CrmProvider {
    if (!this.provider) throw new Error("Cartridge not initialized");
    return this.provider;
  }

  async enrichContext(
    _actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    const contactId = parameters["contactId"] as string | undefined;
    if (!contactId) return {};

    try {
      const contact = await provider.getContact(contactId);
      if (!contact) return {};

      const deals = await provider.listDeals({ contactId });
      const activities = await provider.listActivities({ contactId });
      const lastActivity = activities[0];

      return {
        contactName: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
        contactCompany: contact.company,
        contactChannel: contact.channel,
        dealCount: deals.length,
        totalDealValue: deals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
        activityCount: activities.length,
        lastInteractionDate: lastActivity?.createdAt ?? null,
        contactTags: contact.tags,
      };
    } catch {
      return {
        _enrichmentFailed: true,
      };
    }
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    const provider = this.getProvider();
    const start = Date.now();
    const envelopeId = (parameters["_envelopeId"] as string) ?? "unknown";
    const actionId = (parameters["_actionId"] as string) ?? "unknown";

    switch (actionType) {
      // ── Read actions ──
      case "crm.contact.search": {
        const query = parameters["query"] as string;
        const limit = (parameters["limit"] as number) ?? 20;
        if (!query) {
          return {
            success: false,
            summary: "Missing required parameter: query",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "query is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
        const contacts = await provider.searchContacts(query, limit);
        const summaryLines = contacts.map(
          (c) => `${c.firstName ?? ""} ${c.lastName ?? ""} (${c.email ?? "no email"}) — ${c.company ?? "no company"}`,
        );
        return {
          success: true,
          summary: contacts.length === 0
            ? `No contacts found matching "${query}"`
            : `Found ${contacts.length} contact(s):\n${summaryLines.join("\n")}`,
          externalRefs: { contactIds: contacts.map((c) => c.id).join(",") },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: { contacts },
        };
      }

      case "crm.deal.list": {
        const filters: { contactId?: string; pipeline?: string; stage?: string } = {};
        if (parameters["contactId"]) filters.contactId = parameters["contactId"] as string;
        if (parameters["pipeline"]) filters.pipeline = parameters["pipeline"] as string;
        if (parameters["stage"]) filters.stage = parameters["stage"] as string;
        const deals = await provider.listDeals(filters);
        const summaryLines = deals.map(
          (d) => `${d.name} — ${d.stage} — $${d.amount ?? 0}`,
        );
        return {
          success: true,
          summary: deals.length === 0
            ? "No deals found"
            : `Found ${deals.length} deal(s):\n${summaryLines.join("\n")}`,
          externalRefs: { dealIds: deals.map((d) => d.id).join(",") },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: { deals },
        };
      }

      case "crm.activity.list": {
        const actFilters: { contactId?: string; dealId?: string; type?: string } = {};
        if (parameters["contactId"]) actFilters.contactId = parameters["contactId"] as string;
        if (parameters["dealId"]) actFilters.dealId = parameters["dealId"] as string;
        if (parameters["type"]) actFilters.type = parameters["type"] as string;
        const activities = await provider.listActivities(actFilters);
        const summaryLines = activities.map(
          (a) => `[${a.type}] ${a.subject ?? "(no subject)"} — ${new Date(a.createdAt).toLocaleDateString()}`,
        );
        return {
          success: true,
          summary: activities.length === 0
            ? "No activities found"
            : `Found ${activities.length} activit${activities.length === 1 ? "y" : "ies"}:\n${summaryLines.join("\n")}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: { activities },
        };
      }

      case "crm.pipeline.status": {
        const pipelineId = parameters["pipelineId"] as string | undefined;
        const stages = await provider.getPipelineStatus(pipelineId);
        const summaryLines = stages
          .filter((s) => s.dealCount > 0)
          .map((s) => `${s.label}: ${s.dealCount} deal(s), $${s.totalValue.toLocaleString()}`);
        const totalDeals = stages.reduce((sum, s) => sum + s.dealCount, 0);
        const totalValue = stages.reduce((sum, s) => sum + s.totalValue, 0);
        return {
          success: true,
          summary: totalDeals === 0
            ? "Pipeline is empty"
            : `Pipeline: ${totalDeals} deal(s), $${totalValue.toLocaleString()} total\n${summaryLines.join("\n")}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: { stages },
        };
      }

      // ── Write actions ──
      case "crm.contact.create": {
        const email = parameters["email"] as string;
        if (!email) {
          return {
            success: false,
            summary: "Missing required parameter: email",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "email is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
        const contact = await provider.createContact({
          email,
          firstName: parameters["firstName"] as string | undefined,
          lastName: parameters["lastName"] as string | undefined,
          company: parameters["company"] as string | undefined,
          phone: parameters["phone"] as string | undefined,
          channel: parameters["channel"] as string | undefined,
          properties: parameters["properties"] as Record<string, unknown> | undefined,
        });
        return {
          success: true,
          summary: `Contact ${contact.id} created: ${contact.firstName ?? ""} ${contact.lastName ?? ""} (${contact.email})`,
          externalRefs: { contactId: contact.id },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildContactCreateUndoRecipe(contact.id, envelopeId, actionId),
        };
      }

      case "crm.contact.update": {
        const contactId = parameters["contactId"] as string;
        const data = parameters["data"] as Record<string, unknown>;
        if (!contactId) {
          return {
            success: false,
            summary: "Missing required parameter: contactId",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "contactId is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
        // Capture previous state for undo
        const before = await provider.getContact(contactId);
        const previousData: Record<string, unknown> = {};
        if (before && data) {
          for (const key of Object.keys(data)) {
            previousData[key] = (before as unknown as Record<string, unknown>)[key];
          }
        }
        await provider.updateContact(contactId, data ?? {});
        return {
          success: true,
          summary: `Contact ${contactId} updated: ${Object.keys(data ?? {}).join(", ")}`,
          externalRefs: { contactId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildContactUpdateUndoRecipe(contactId, previousData, envelopeId, actionId),
        };
      }

      case "crm.deal.create": {
        const name = parameters["name"] as string;
        if (!name) {
          return {
            success: false,
            summary: "Missing required parameter: name",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "name is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
        const deal = await provider.createDeal({
          name,
          pipeline: parameters["pipeline"] as string | undefined,
          stage: parameters["stage"] as string | undefined,
          amount: parameters["amount"] as number | undefined,
          contactIds: parameters["contactIds"] as string[] | undefined,
        });
        const amountStr = deal.amount != null ? ` worth $${deal.amount.toLocaleString()}` : "";
        return {
          success: true,
          summary: `Deal ${deal.id} created: "${deal.name}"${amountStr} in ${deal.stage}`,
          externalRefs: { dealId: deal.id },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildDealCreateUndoRecipe(deal.id, envelopeId, actionId),
        };
      }

      case "crm.activity.log": {
        const type = parameters["type"] as string;
        const validTypes = ["note", "email", "call", "meeting", "task"];
        if (!type || !validTypes.includes(type)) {
          return {
            success: false,
            summary: `Invalid or missing activity type. Must be one of: ${validTypes.join(", ")}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "valid activity type is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
        const activity = await provider.logActivity({
          type: type as "note" | "email" | "call" | "meeting" | "task",
          subject: parameters["subject"] as string | undefined,
          body: parameters["body"] as string | undefined,
          contactIds: parameters["contactIds"] as string[] | undefined,
          dealIds: parameters["dealIds"] as string[] | undefined,
        });
        return {
          success: true,
          summary: `Activity ${activity.id} logged: [${activity.type}] ${activity.subject ?? activity.body ?? "(no subject)"}`,
          externalRefs: { activityId: activity.id },
          rollbackAvailable: false, // activities are irreversible
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
      }

      default:
        return {
          success: false,
          summary: `Unknown action type: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "execute", error: `Unknown action type: ${actionType}` }],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
    }
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    switch (actionType) {
      case "crm.contact.search":
        return computeContactSearchRiskInput();
      case "crm.deal.list":
        return computeDealListRiskInput();
      case "crm.activity.list":
        return computeActivityListRiskInput();
      case "crm.pipeline.status":
        return computePipelineStatusRiskInput();
      case "crm.contact.create":
        return computeContactCreateRiskInput();
      case "crm.contact.update":
        return computeContactUpdateRiskInput();
      case "crm.deal.create": {
        const amount = (parameters["amount"] as number) ?? 0;
        return computeDealCreateRiskInput(amount);
      }
      case "crm.activity.log":
        return computeActivityLogRiskInput();
      default:
        return {
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 0, blastRadius: 1 },
          reversibility: "full",
          sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
        };
    }
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_CRM_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return this.getProvider().healthCheck();
  }

  async captureSnapshot(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    const snapshot: Record<string, unknown> = {
      capturedAt: new Date().toISOString(),
      actionType,
    };

    try {
      const contactId = parameters["contactId"] as string | undefined;
      if (contactId) {
        const contact = await provider.getContact(contactId);
        if (contact) {
          snapshot["contact"] = {
            id: contact.id,
            email: contact.email,
            firstName: contact.firstName,
            lastName: contact.lastName,
            company: contact.company,
            status: contact.status,
          };
        }
      }
    } catch {
      snapshot["_snapshotError"] = "Failed to capture pre-mutation state";
    }

    return snapshot;
  }
}

export { CRM_MANIFEST } from "./manifest.js";
export { DEFAULT_CRM_GUARDRAILS } from "./defaults/guardrails.js";
export { DEFAULT_CRM_POLICIES } from "./defaults/policies.js";
export { bootstrapCrmCartridge } from "./bootstrap.js";
export type { BootstrapCrmConfig, BootstrapCrmResult } from "./bootstrap.js";
export type { CrmProvider, CrmContact, CrmDeal, CrmActivity, CrmPipelineStage } from "./providers/crm-provider.js";
export { InMemoryCrmProvider } from "./providers/mock.js";
