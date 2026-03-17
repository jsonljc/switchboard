import type { ConnectionHealth } from "@switchboard/schemas";
import type {
  CrmProvider,
  CrmContact,
  CrmDeal,
  CrmActivity,
  CrmPipelineStage,
} from "./crm-provider.js";

// ── Seed data ──

const SEED_CONTACTS: CrmContact[] = [
  {
    id: "ct_alice",
    externalId: null,
    channel: "email",
    email: "alice@acmecorp.com",
    firstName: "Alice",
    lastName: "Johnson",
    company: "Acme Corp",
    phone: "+1-555-0101",
    tags: ["enterprise", "decision-maker"],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    utmSource: null,
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    properties: { title: "VP of Engineering", source: "inbound" },
  },
  {
    id: "ct_bob",
    externalId: null,
    channel: "telegram",
    email: "bob@startup.io",
    firstName: "Bob",
    lastName: "Chen",
    company: "Startup.io",
    phone: "+1-555-0202",
    tags: ["startup", "technical"],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    utmSource: null,
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    properties: { title: "CTO", source: "referral" },
  },
  {
    id: "ct_carol",
    externalId: null,
    channel: "web",
    email: "carol@bigretail.com",
    firstName: "Carol",
    lastName: "Martinez",
    company: "Big Retail Inc",
    phone: "+1-555-0303",
    tags: ["enterprise", "procurement"],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    utmSource: null,
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    properties: { title: "Head of Procurement", source: "cold-outreach" },
  },
  {
    id: "ct_dave",
    externalId: null,
    channel: "email",
    email: "dave@freelance.dev",
    firstName: "Dave",
    lastName: "Park",
    company: null,
    phone: null,
    tags: ["freelancer"],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    utmSource: null,
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    properties: { source: "website-signup" },
  },
];

const PIPELINE_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "closed-won",
  "closed-lost",
];

const SEED_DEALS: CrmDeal[] = [
  {
    id: "deal_1",
    name: "Acme Corp Enterprise License",
    stage: "negotiation",
    pipeline: "default",
    amount: 50000,
    closeDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    contactIds: ["ct_alice"],
    assignedStaffId: null,
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    properties: {},
  },
  {
    id: "deal_2",
    name: "Startup.io Pilot Program",
    stage: "proposal",
    pipeline: "default",
    amount: 12000,
    closeDate: new Date(Date.now() + 14 * 86400000).toISOString(),
    contactIds: ["ct_bob"],
    assignedStaffId: null,
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    properties: {},
  },
  {
    id: "deal_3",
    name: "Big Retail RFP Response",
    stage: "qualified",
    pipeline: "default",
    amount: 120000,
    closeDate: new Date(Date.now() + 60 * 86400000).toISOString(),
    contactIds: ["ct_carol"],
    assignedStaffId: null,
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    properties: {},
  },
  {
    id: "deal_4",
    name: "Freelancer Pro Subscription",
    stage: "lead",
    pipeline: "default",
    amount: 500,
    closeDate: null,
    contactIds: ["ct_dave"],
    assignedStaffId: null,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    properties: {},
  },
];

const SEED_ACTIVITIES: CrmActivity[] = [
  {
    id: "act_1",
    type: "call",
    subject: "Discovery Call",
    body: "Discussed enterprise requirements. Alice interested in annual contract.",
    contactIds: ["ct_alice"],
    dealIds: ["deal_1"],
    createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
  },
  {
    id: "act_2",
    type: "email",
    subject: "Proposal Follow-up",
    body: "Sent revised pricing for Acme Corp enterprise deal.",
    contactIds: ["ct_alice"],
    dealIds: ["deal_1"],
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  {
    id: "act_3",
    type: "meeting",
    subject: "Technical Demo",
    body: "Walked Bob through API integration. Very positive feedback.",
    contactIds: ["ct_bob"],
    dealIds: ["deal_2"],
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: "act_4",
    type: "note",
    subject: "RFP Received",
    body: "Carol sent formal RFP. Due date in 60 days.",
    contactIds: ["ct_carol"],
    dealIds: ["deal_3"],
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  {
    id: "act_5",
    type: "task",
    subject: "Send pricing sheet",
    body: "Prepare and send pricing sheet to Dave for freelancer tier.",
    contactIds: ["ct_dave"],
    dealIds: ["deal_4"],
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

export class InMemoryCrmProvider implements CrmProvider {
  private contacts = new Map<string, CrmContact>();
  private deals = new Map<string, CrmDeal>();
  private activities = new Map<string, CrmActivity>();
  private nextId = 100;

  constructor() {
    for (const c of SEED_CONTACTS)
      this.contacts.set(c.id, { ...c, tags: [...c.tags], properties: { ...c.properties } });
    for (const d of SEED_DEALS)
      this.deals.set(d.id, {
        ...d,
        contactIds: [...d.contactIds],
        properties: { ...d.properties },
      });
    for (const a of SEED_ACTIVITIES)
      this.activities.set(a.id, { ...a, contactIds: [...a.contactIds], dealIds: [...a.dealIds] });
  }

  private genId(prefix: string): string {
    return `${prefix}_mock_${this.nextId++}`;
  }

  async searchContacts(query: string, limit = 20): Promise<CrmContact[]> {
    const q = query.toLowerCase();
    return [...this.contacts.values()]
      .filter(
        (c) =>
          c.status === "active" &&
          (c.firstName?.toLowerCase().includes(q) ||
            c.lastName?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.company?.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q)),
      )
      .slice(0, limit);
  }

  async getContact(contactId: string): Promise<CrmContact | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async findByExternalId(externalId: string, channel?: string): Promise<CrmContact | null> {
    for (const contact of this.contacts.values()) {
      if (contact.externalId === externalId) {
        if (channel && contact.channel !== channel) continue;
        return { ...contact };
      }
    }
    return null;
  }

  async listDeals(filters?: {
    contactId?: string;
    pipeline?: string;
    stage?: string;
  }): Promise<CrmDeal[]> {
    let deals = [...this.deals.values()];
    if (filters?.contactId) {
      deals = deals.filter((d) => d.contactIds.includes(filters.contactId!));
    }
    if (filters?.pipeline) {
      deals = deals.filter((d) => d.pipeline === filters.pipeline);
    }
    if (filters?.stage) {
      deals = deals.filter((d) => d.stage === filters.stage);
    }
    return deals;
  }

  async listActivities(filters?: {
    contactId?: string;
    dealId?: string;
    type?: string;
  }): Promise<CrmActivity[]> {
    let activities = [...this.activities.values()];
    if (filters?.contactId) {
      activities = activities.filter((a) => a.contactIds.includes(filters.contactId!));
    }
    if (filters?.dealId) {
      activities = activities.filter((a) => a.dealIds.includes(filters.dealId!));
    }
    if (filters?.type) {
      activities = activities.filter((a) => a.type === filters.type);
    }
    return activities.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getPipelineStatus(pipelineId?: string): Promise<CrmPipelineStage[]> {
    const pipeline = pipelineId ?? "default";
    const deals = [...this.deals.values()].filter((d) => d.pipeline === pipeline);

    return PIPELINE_STAGES.map((stage, i) => {
      const stageDeals = deals.filter((d) => d.stage === stage);
      return {
        id: stage,
        label: stage.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        displayOrder: i,
        dealCount: stageDeals.length,
        totalValue: stageDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      };
    });
  }

  async createContact(data: {
    externalId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    channel?: string;
    assignedStaffId?: string;
    sourceAdId?: string;
    sourceCampaignId?: string;
    utmSource?: string;
    properties?: Record<string, unknown>;
  }): Promise<CrmContact> {
    const now = new Date().toISOString();
    const contact: CrmContact = {
      id: this.genId("ct"),
      externalId: data.externalId ?? null,
      channel: data.channel ?? null,
      email: data.email ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      company: data.company ?? null,
      phone: data.phone ?? null,
      tags: [],
      status: "active",
      assignedStaffId: data.assignedStaffId ?? null,
      sourceAdId: data.sourceAdId ?? null,
      sourceCampaignId: data.sourceCampaignId ?? null,
      gclid: null,
      fbclid: null,
      ttclid: null,
      utmSource: data.utmSource ?? null,
      createdAt: now,
      updatedAt: now,
      properties: data.properties ?? {},
    };
    this.contacts.set(contact.id, contact);
    return { ...contact };
  }

  async updateContact(contactId: string, data: Record<string, unknown>): Promise<CrmContact> {
    const contact = this.contacts.get(contactId);
    if (!contact) throw new Error(`Contact ${contactId} not found`);

    const updatable = [
      "email",
      "firstName",
      "lastName",
      "company",
      "phone",
      "channel",
      "tags",
      "status",
      "assignedStaffId",
      "sourceAdId",
      "sourceCampaignId",
      "utmSource",
    ] as const;
    for (const key of updatable) {
      if (data[key] !== undefined) {
        (contact as unknown as Record<string, unknown>)[key] = data[key];
      }
    }
    if (data["properties"] && typeof data["properties"] === "object") {
      contact.properties = {
        ...contact.properties,
        ...(data["properties"] as Record<string, unknown>),
      };
    }
    contact.updatedAt = new Date().toISOString();
    return { ...contact };
  }

  async archiveContact(contactId: string): Promise<void> {
    const contact = this.contacts.get(contactId);
    if (contact) {
      contact.status = "archived";
      contact.updatedAt = new Date().toISOString();
    }
  }

  async createDeal(data: {
    name: string;
    pipeline?: string;
    stage?: string;
    amount?: number;
    contactIds?: string[];
    assignedStaffId?: string;
  }): Promise<CrmDeal> {
    const now = new Date().toISOString();
    const deal: CrmDeal = {
      id: this.genId("deal"),
      name: data.name,
      stage: data.stage ?? "lead",
      pipeline: data.pipeline ?? "default",
      amount: data.amount ?? null,
      closeDate: null,
      contactIds: data.contactIds ?? [],
      assignedStaffId: data.assignedStaffId ?? null,
      createdAt: now,
      updatedAt: now,
      properties: {},
    };
    this.deals.set(deal.id, deal);
    return { ...deal };
  }

  async archiveDeal(dealId: string): Promise<void> {
    this.deals.delete(dealId);
  }

  async logActivity(data: {
    type: CrmActivity["type"];
    subject?: string;
    body?: string;
    contactIds?: string[];
    dealIds?: string[];
  }): Promise<CrmActivity> {
    const activity: CrmActivity = {
      id: this.genId("act"),
      type: data.type,
      subject: data.subject ?? null,
      body: data.body ?? null,
      contactIds: data.contactIds ?? [],
      dealIds: data.dealIds ?? [],
      createdAt: new Date().toISOString(),
    };
    this.activities.set(activity.id, activity);
    return { ...activity };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return {
      status: "connected",
      latencyMs: 1,
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
  }
}
