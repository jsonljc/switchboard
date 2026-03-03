// ---------------------------------------------------------------------------
// HubSpot CRM Provider — Real HubSpot API v3 integration
// ---------------------------------------------------------------------------

import type { ConnectionHealth } from "@switchboard/schemas";
import type {
  CrmProvider,
  CrmContact,
  CrmDeal,
  CrmActivity,
  CrmPipelineStage,
} from "./crm-provider.js";
import { withRetry, CircuitBreaker } from "@switchboard/core";

export interface HubSpotConfig {
  /** HubSpot private app access token */
  accessToken: string;
  /** Pipeline ID for deal operations (defaults to "default") */
  pipelineId?: string;
}

const HUBSPOT_BASE = "https://api.hubapi.com";

/**
 * Real HubSpot CRM provider using the HubSpot API v3.
 * All calls wrapped with retry + circuit breaker.
 *
 * API Reference: https://developers.hubspot.com/docs/api/crm
 */
export class HubSpotCrmProvider implements CrmProvider {
  private readonly config: HubSpotConfig;
  private readonly breaker: CircuitBreaker;

  constructor(config: HubSpotConfig) {
    this.config = config;
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 3,
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(() =>
      withRetry(fn, {
        maxAttempts: 3,
        shouldRetry: (err: unknown) => {
          if (err instanceof Error) {
            const msg = err.message;
            return (
              msg.includes("429") ||
              msg.includes("ETIMEDOUT") ||
              msg.includes("ECONNRESET") ||
              msg.includes("502") ||
              msg.includes("503")
            );
          }
          return false;
        },
      }),
    );
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  // ── Read Operations ──

  async searchContacts(query: string, limit = 20): Promise<CrmContact[]> {
    return this.call(async () => {
      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          query,
          limit: Math.min(limit, 100),
          properties: [
            "email",
            "firstname",
            "lastname",
            "company",
            "phone",
            "hs_lead_status",
            "createdate",
            "lastmodifieddate",
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        results: Array<{
          id: string;
          properties: Record<string, string | null>;
          createdAt: string;
          updatedAt: string;
        }>;
      };

      return data.results.map((r) => this.mapContact(r));
    });
  }

  async getContact(contactId: string): Promise<CrmContact | null> {
    return this.call(async () => {
      const response = await fetch(
        `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,company,phone,hs_lead_status`,
        {
          method: "GET",
          headers: this.authHeaders(),
        },
      );

      if (response.status === 404) return null;

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        id: string;
        properties: Record<string, string | null>;
        createdAt: string;
        updatedAt: string;
      };

      return this.mapContact(data);
    });
  }

  async listDeals(filters?: {
    contactId?: string;
    pipeline?: string;
    stage?: string;
  }): Promise<CrmDeal[]> {
    return this.call(async () => {
      const filterGroups: Array<{
        filters: Array<{ propertyName: string; operator: string; value: string }>;
      }> = [];
      const innerFilters: Array<{ propertyName: string; operator: string; value: string }> = [];

      if (filters?.pipeline) {
        innerFilters.push({ propertyName: "pipeline", operator: "EQ", value: filters.pipeline });
      }
      if (filters?.stage) {
        innerFilters.push({ propertyName: "dealstage", operator: "EQ", value: filters.stage });
      }
      if (innerFilters.length > 0) {
        filterGroups.push({ filters: innerFilters });
      }

      const body: Record<string, unknown> = {
        limit: 100,
        properties: ["dealname", "dealstage", "pipeline", "amount", "closedate"],
      };
      if (filterGroups.length > 0) {
        body["filterGroups"] = filterGroups;
      }

      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        results: Array<{
          id: string;
          properties: Record<string, string | null>;
          createdAt: string;
          updatedAt: string;
        }>;
      };

      let deals = data.results.map((r) => this.mapDeal(r));

      // If filtering by contactId, fetch associations
      if (filters?.contactId) {
        const associatedDealIds = await this.getContactDealAssociations(filters.contactId);
        deals = deals.filter((d) => associatedDealIds.has(d.id));
      }

      return deals;
    });
  }

  async listActivities(filters?: {
    contactId?: string;
    dealId?: string;
    type?: string;
  }): Promise<CrmActivity[]> {
    return this.call(async () => {
      // HubSpot uses "engagements" for activities (notes, emails, calls, meetings, tasks)
      const hsType = filters?.type ? this.mapActivityTypeToHubSpot(filters.type) : undefined;
      let url = `${HUBSPOT_BASE}/crm/v3/objects/`;

      if (hsType) {
        url += `${hsType}?limit=50`;
      } else {
        // Default to notes
        url += `notes?limit=50`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: this.authHeaders(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        results: Array<{
          id: string;
          properties: Record<string, string | null>;
          createdAt: string;
        }>;
      };

      return data.results.map((r) => ({
        id: r.id,
        type: (filters?.type ?? "note") as CrmActivity["type"],
        subject: r.properties["hs_timestamp"] ?? null,
        body: r.properties["hs_note_body"] ?? r.properties["hs_body_preview"] ?? null,
        contactIds: filters?.contactId ? [filters.contactId] : [],
        dealIds: filters?.dealId ? [filters.dealId] : [],
        createdAt: r.createdAt,
      }));
    });
  }

  async getPipelineStatus(pipelineId?: string): Promise<CrmPipelineStage[]> {
    return this.call(async () => {
      const pipeline = pipelineId ?? this.config.pipelineId ?? "default";
      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/pipelines/deals/${pipeline}`, {
        method: "GET",
        headers: this.authHeaders(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        stages: Array<{
          id: string;
          label: string;
          displayOrder: number;
        }>;
      };

      // Get deal counts per stage
      const stages: CrmPipelineStage[] = [];
      for (const stage of data.stages) {
        const countResponse = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  { propertyName: "dealstage", operator: "EQ", value: stage.id },
                  { propertyName: "pipeline", operator: "EQ", value: pipeline },
                ],
              },
            ],
            limit: 0,
            properties: ["amount"],
          }),
        });

        let dealCount = 0;
        let totalValue = 0;

        if (countResponse.ok) {
          const countData = (await countResponse.json()) as {
            total: number;
            results: Array<{ properties: Record<string, string | null> }>;
          };
          dealCount = countData.total ?? 0;
          totalValue =
            countData.results?.reduce(
              (sum, r) => sum + (parseFloat(r.properties["amount"] ?? "0") || 0),
              0,
            ) ?? 0;
        }

        stages.push({
          id: stage.id,
          label: stage.label,
          displayOrder: stage.displayOrder,
          dealCount,
          totalValue,
        });
      }

      return stages;
    });
  }

  // ── Write Operations ──

  async createContact(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    channel?: string;
    properties?: Record<string, unknown>;
  }): Promise<CrmContact> {
    return this.call(async () => {
      const properties: Record<string, string> = {
        email: data.email,
      };
      if (data.firstName) properties["firstname"] = data.firstName;
      if (data.lastName) properties["lastname"] = data.lastName;
      if (data.company) properties["company"] = data.company;
      if (data.phone) properties["phone"] = data.phone;
      if (data.channel) properties["hs_lead_status"] = data.channel;

      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const result = (await response.json()) as {
        id: string;
        properties: Record<string, string | null>;
        createdAt: string;
        updatedAt: string;
      };

      return this.mapContact(result);
    });
  }

  async updateContact(contactId: string, data: Record<string, unknown>): Promise<CrmContact> {
    return this.call(async () => {
      const properties: Record<string, unknown> = {};
      if (data["email"]) properties["email"] = data["email"];
      if (data["firstName"]) properties["firstname"] = data["firstName"];
      if (data["lastName"]) properties["lastname"] = data["lastName"];
      if (data["company"]) properties["company"] = data["company"];
      if (data["phone"]) properties["phone"] = data["phone"];

      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: "PATCH",
        headers: this.authHeaders(),
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const result = (await response.json()) as {
        id: string;
        properties: Record<string, string | null>;
        createdAt: string;
        updatedAt: string;
      };

      return this.mapContact(result);
    });
  }

  async archiveContact(contactId: string): Promise<void> {
    return this.call(async () => {
      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });

      if (!response.ok && response.status !== 404) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }
    });
  }

  async createDeal(data: {
    name: string;
    pipeline?: string;
    stage?: string;
    amount?: number;
    contactIds?: string[];
  }): Promise<CrmDeal> {
    return this.call(async () => {
      const properties: Record<string, unknown> = {
        dealname: data.name,
        pipeline: data.pipeline ?? this.config.pipelineId ?? "default",
      };
      if (data.stage) properties["dealstage"] = data.stage;
      if (data.amount != null) properties["amount"] = String(data.amount);

      const body: Record<string, unknown> = { properties };

      // Associate with contacts if provided
      if (data.contactIds && data.contactIds.length > 0) {
        body["associations"] = data.contactIds.map((contactId) => ({
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        }));
      }

      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const result = (await response.json()) as {
        id: string;
        properties: Record<string, string | null>;
        createdAt: string;
        updatedAt: string;
      };

      return this.mapDeal(result, data.contactIds);
    });
  }

  async archiveDeal(dealId: string): Promise<void> {
    return this.call(async () => {
      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });

      if (!response.ok && response.status !== 404) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }
    });
  }

  async logActivity(data: {
    type: CrmActivity["type"];
    subject?: string;
    body?: string;
    contactIds?: string[];
    dealIds?: string[];
  }): Promise<CrmActivity> {
    return this.call(async () => {
      const hsType = this.mapActivityTypeToHubSpot(data.type);
      const properties: Record<string, string> = {};

      if (hsType === "notes") {
        if (data.body) properties["hs_note_body"] = data.body;
        properties["hs_timestamp"] = new Date().toISOString();
      } else {
        if (data.subject) properties["hs_timestamp"] = new Date().toISOString();
        if (data.body) properties["hs_body_preview"] = data.body;
      }

      const associations: Array<{
        to: { id: string };
        types: Array<{ associationCategory: string; associationTypeId: number }>;
      }> = [];

      for (const contactId of data.contactIds ?? []) {
        associations.push({
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
        });
      }

      for (const dealId of data.dealIds ?? []) {
        associations.push({
          to: { id: dealId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }],
        });
      }

      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${hsType}`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ properties, associations }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${errorBody}`);
      }

      const result = (await response.json()) as {
        id: string;
        createdAt: string;
      };

      return {
        id: result.id,
        type: data.type,
        subject: data.subject ?? null,
        body: data.body ?? null,
        contactIds: data.contactIds ?? [],
        dealIds: data.dealIds ?? [],
        createdAt: result.createdAt,
      };
    });
  }

  // ── Health ──

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts?limit=1`, {
        method: "GET",
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return {
          status: "disconnected",
          latencyMs: Date.now() - start,
          error: `HubSpot returned ${response.status}`,
          capabilities: [],
        };
      }

      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
        capabilities: [
          "crm.contact.search",
          "crm.contact.create",
          "crm.contact.update",
          "crm.deal.list",
          "crm.deal.create",
          "crm.activity.list",
          "crm.activity.log",
          "crm.pipeline.status",
          "crm.pipeline.diagnose",
          "crm.activity.analyze",
        ],
      };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Unknown error",
        capabilities: [],
      };
    }
  }

  // ── Helpers ──

  private mapContact(raw: {
    id: string;
    properties: Record<string, string | null>;
    createdAt: string;
    updatedAt: string;
  }): CrmContact {
    return {
      id: raw.id,
      externalId: raw.id,
      channel: raw.properties["hs_lead_status"] ?? null,
      email: raw.properties["email"] ?? null,
      firstName: raw.properties["firstname"] ?? null,
      lastName: raw.properties["lastname"] ?? null,
      company: raw.properties["company"] ?? null,
      phone: raw.properties["phone"] ?? null,
      tags: [],
      status: "active",
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      properties: raw.properties as Record<string, unknown>,
    };
  }

  private mapDeal(
    raw: {
      id: string;
      properties: Record<string, string | null>;
      createdAt: string;
      updatedAt: string;
    },
    contactIds?: string[],
  ): CrmDeal {
    return {
      id: raw.id,
      name: raw.properties["dealname"] ?? "",
      stage: raw.properties["dealstage"] ?? "unknown",
      pipeline: raw.properties["pipeline"] ?? "default",
      amount: raw.properties["amount"] ? parseFloat(raw.properties["amount"]) : null,
      closeDate: raw.properties["closedate"] ?? null,
      contactIds: contactIds ?? [],
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      properties: raw.properties as Record<string, unknown>,
    };
  }

  private mapActivityTypeToHubSpot(type: string): string {
    const map: Record<string, string> = {
      note: "notes",
      email: "emails",
      call: "calls",
      meeting: "meetings",
      task: "tasks",
    };
    return map[type] ?? "notes";
  }

  private async getContactDealAssociations(contactId: string): Promise<Set<string>> {
    try {
      const response = await fetch(
        `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}/associations/deals`,
        {
          method: "GET",
          headers: this.authHeaders(),
        },
      );

      if (!response.ok) return new Set();

      const data = (await response.json()) as {
        results: Array<{ id: string }>;
      };

      return new Set(data.results.map((r) => r.id));
    } catch {
      return new Set();
    }
  }
}
