import { describe, it, expect, beforeEach } from "vitest";
import type {
  Contact,
  ContactStage,
  Opportunity,
  OpportunityStage,
  LifecycleRevenueEvent,
  OwnerTask,
  TaskStatus,
} from "@switchboard/schemas";
import type { ContactStore, CreateContactInput } from "../contact-store.js";
import type { OpportunityStore, CreateOpportunityInput } from "../opportunity-store.js";
import type { RevenueStore, RecordRevenueInput, RevenueSummary } from "../revenue-store.js";
import type { OwnerTaskStore, CreateOwnerTaskInput } from "../owner-task-store.js";
import { ContactLifecycleService } from "../lifecycle-service.js";

// ---------------------------------------------------------------------------
// In-Memory Store Implementations
// ---------------------------------------------------------------------------

class InMemoryContactStore implements ContactStore {
  private contacts = new Map<string, Contact>();
  private idCounter = 1;

  async create(input: CreateContactInput): Promise<Contact> {
    const id = `contact-${this.idCounter++}`;
    const now = new Date();
    const contact: Contact = {
      id,
      organizationId: input.organizationId,
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      primaryChannel: input.primaryChannel,
      firstTouchChannel: input.firstTouchChannel ?? null,
      stage: "new",
      source: input.source ?? null,
      attribution: (input.attribution as Contact["attribution"]) ?? null,
      roles: input.roles ?? ["lead"],
      firstContactAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.contacts.set(id, contact);
    return contact;
  }

  async findById(_orgId: string, id: string): Promise<Contact | null> {
    return this.contacts.get(id) ?? null;
  }

  async findByPhone(_orgId: string, phone: string): Promise<Contact | null> {
    for (const contact of this.contacts.values()) {
      if (contact.phone === phone) return contact;
    }
    return null;
  }

  async updateStage(_orgId: string, id: string, stage: ContactStage): Promise<Contact> {
    const contact = this.contacts.get(id);
    if (!contact) throw new Error(`Contact not found: ${id}`);
    const updated = { ...contact, stage, updatedAt: new Date() };
    this.contacts.set(id, updated);
    return updated;
  }

  async updateLastActivity(_orgId: string, id: string): Promise<void> {
    const contact = this.contacts.get(id);
    if (!contact) throw new Error(`Contact not found: ${id}`);
    const updated = { ...contact, lastActivityAt: new Date(), updatedAt: new Date() };
    this.contacts.set(id, updated);
  }

  async list(_orgId: string): Promise<Contact[]> {
    return Array.from(this.contacts.values());
  }
}

class InMemoryOpportunityStore implements OpportunityStore {
  private opportunities = new Map<string, Opportunity>();
  private idCounter = 1;

  async create(input: CreateOpportunityInput): Promise<Opportunity> {
    const id = `opportunity-${this.idCounter++}`;
    const now = new Date();
    const opportunity: Opportunity = {
      id,
      organizationId: input.organizationId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      stage: "interested",
      estimatedValue: input.estimatedValue ?? null,
      revenueTotal: 0,
      assignedAgent: input.assignedAgent ?? null,
      assignedStaff: null,
      lostReason: null,
      notes: null,
      objections: [],
      qualificationComplete: false,
      openedAt: now,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.opportunities.set(id, opportunity);
    return opportunity;
  }

  async findById(_orgId: string, id: string): Promise<Opportunity | null> {
    return this.opportunities.get(id) ?? null;
  }

  async findByContact(_orgId: string, contactId: string): Promise<Opportunity[]> {
    return Array.from(this.opportunities.values()).filter((o) => o.contactId === contactId);
  }

  async findActiveByContact(_orgId: string, contactId: string): Promise<Opportunity[]> {
    const TERMINAL: OpportunityStage[] = ["won", "lost"];
    return Array.from(this.opportunities.values()).filter(
      (o) => o.contactId === contactId && !TERMINAL.includes(o.stage as OpportunityStage),
    );
  }

  async updateStage(
    _orgId: string,
    id: string,
    stage: OpportunityStage,
    closedAt?: Date | null,
  ): Promise<Opportunity> {
    const opportunity = this.opportunities.get(id);
    if (!opportunity) throw new Error(`Opportunity not found: ${id}`);
    const updated = {
      ...opportunity,
      stage,
      closedAt: closedAt === undefined ? opportunity.closedAt : closedAt,
      updatedAt: new Date(),
    };
    this.opportunities.set(id, updated);
    return updated;
  }

  async updateRevenueTotal(_orgId: string, id: string): Promise<void> {
    const opportunity = this.opportunities.get(id);
    if (!opportunity) throw new Error(`Opportunity not found: ${id}`);
    // In-memory simplification: just increment by 1000 (test will validate behavior)
    const updated = {
      ...opportunity,
      revenueTotal: opportunity.revenueTotal + 1000,
      updatedAt: new Date(),
    };
    this.opportunities.set(id, updated);
  }

  async countByStage(
    _orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>> {
    const counts = new Map<OpportunityStage, { count: number; totalValue: number }>();
    for (const opp of this.opportunities.values()) {
      const stage = opp.stage as OpportunityStage;
      const existing = counts.get(stage) ?? { count: 0, totalValue: 0 };
      counts.set(stage, {
        count: existing.count + 1,
        totalValue: existing.totalValue + (opp.estimatedValue ?? 0),
      });
    }
    return Array.from(counts.entries()).map(([stage, data]) => ({ stage, ...data }));
  }
}

class InMemoryRevenueStore implements RevenueStore {
  private events = new Map<string, LifecycleRevenueEvent>();
  private idCounter = 1;

  async record(input: RecordRevenueInput): Promise<LifecycleRevenueEvent> {
    const id = `revenue-${this.idCounter++}`;
    const now = new Date();
    const event: LifecycleRevenueEvent = {
      id,
      organizationId: input.organizationId,
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      amount: input.amount,
      currency: input.currency ?? "SGD",
      type: input.type,
      status: input.status ?? "confirmed",
      recordedBy: input.recordedBy,
      externalReference: input.externalReference ?? null,
      verified: input.verified ?? false,
      sourceCampaignId: input.sourceCampaignId ?? null,
      sourceAdId: input.sourceAdId ?? null,
      recordedAt: now,
      createdAt: now,
    };
    this.events.set(id, event);
    return event;
  }

  async findByOpportunity(_orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]> {
    return Array.from(this.events.values()).filter((e) => e.opportunityId === opportunityId);
  }

  async sumByOrg(_orgId: string): Promise<RevenueSummary> {
    const events = Array.from(this.events.values());
    const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);
    return { totalAmount, count: events.length };
  }

  async sumByCampaign(
    _orgId: string,
  ): Promise<Array<{ sourceCampaignId: string; totalAmount: number; count: number }>> {
    const campaigns = new Map<string, { totalAmount: number; count: number }>();
    for (const event of this.events.values()) {
      if (!event.sourceCampaignId) continue;
      const existing = campaigns.get(event.sourceCampaignId) ?? { totalAmount: 0, count: 0 };
      campaigns.set(event.sourceCampaignId, {
        totalAmount: existing.totalAmount + event.amount,
        count: existing.count + 1,
      });
    }
    return Array.from(campaigns.entries()).map(([sourceCampaignId, data]) => ({
      sourceCampaignId,
      ...data,
    }));
  }
}

class InMemoryOwnerTaskStore implements OwnerTaskStore {
  private tasks = new Map<string, OwnerTask>();
  private idCounter = 1;

  async create(input: CreateOwnerTaskInput): Promise<OwnerTask> {
    const id = `task-${this.idCounter++}`;
    const now = new Date();
    const task: OwnerTask = {
      id,
      organizationId: input.organizationId,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      type: input.type,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction ?? null,
      status: "pending",
      priority: input.priority,
      triggerReason: input.triggerReason,
      sourceAgent: input.sourceAgent ?? null,
      fallbackReason: input.fallbackReason ?? null,
      dueAt: input.dueAt ?? null,
      completedAt: null,
      createdAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  async findPending(_orgId: string): Promise<OwnerTask[]> {
    return Array.from(this.tasks.values()).filter((t) => t.status === "pending");
  }

  async updateStatus(
    _orgId: string,
    id: string,
    status: TaskStatus,
    completedAt?: Date,
  ): Promise<OwnerTask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const updated = { ...task, status, completedAt: completedAt ?? task.completedAt };
    this.tasks.set(id, updated);
    return updated;
  }

  async autoComplete(_orgId: string, opportunityId: string, _reason: string): Promise<number> {
    let count = 0;
    for (const [id, task] of this.tasks.entries()) {
      if (task.opportunityId === opportunityId && task.status === "pending") {
        const updated = { ...task, status: "completed" as TaskStatus, completedAt: new Date() };
        this.tasks.set(id, updated);
        count++;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContactLifecycleService", () => {
  let service: ContactLifecycleService;
  let contactStore: InMemoryContactStore;
  let opportunityStore: InMemoryOpportunityStore;
  let revenueStore: InMemoryRevenueStore;
  let ownerTaskStore: InMemoryOwnerTaskStore;

  beforeEach(() => {
    contactStore = new InMemoryContactStore();
    opportunityStore = new InMemoryOpportunityStore();
    revenueStore = new InMemoryRevenueStore();
    ownerTaskStore = new InMemoryOwnerTaskStore();

    service = new ContactLifecycleService({
      contactStore,
      opportunityStore,
      revenueStore,
      ownerTaskStore,
      defaultDormancyThresholdDays: 30,
      defaultReopenWindowDays: 90,
    });
  });

  it("createContact() — creates contact with stage 'new'", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    expect(contact.stage).toBe("new");
    expect(contact.name).toBe("Jane Doe");
    expect(contact.organizationId).toBe("org-1");
  });

  it("createOpportunity() — creates opportunity, refreshes contact stage to 'active'", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    expect(contact.stage).toBe("new");

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    expect(opportunity.stage).toBe("interested");

    const refreshedContact = await service.getContact("org-1", contact.id);
    expect(refreshedContact?.stage).toBe("active");
  });

  it("advanceOpportunityStage() — valid transition: updates stage, returns advancementData", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    const result = await service.advanceOpportunityStage(
      "org-1",
      opportunity.id,
      "qualified",
      "agent-1",
    );

    expect(result.opportunity.stage).toBe("qualified");
    expect(result.advancementData.previousStage).toBe("interested");
    expect(result.advancementData.newStage).toBe("qualified");
    expect(result.advancementData.advancedBy).toBe("agent-1");
    expect(result.advancementData.serviceName).toBe("Haircut");
  });

  it("advanceOpportunityStage() — invalid transition: throws with reason", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    await expect(
      service.advanceOpportunityStage("org-1", opportunity.id, "won", "agent-1"),
    ).rejects.toThrow(/Invalid transition/);
  });

  it("advanceOpportunityStage() to 'won': sets closedAt, refreshes contact to 'customer'", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    // Advance through stages to reach "showed"
    await service.advanceOpportunityStage("org-1", opportunity.id, "qualified", "agent-1");
    await service.advanceOpportunityStage("org-1", opportunity.id, "booked", "agent-1");
    await service.advanceOpportunityStage("org-1", opportunity.id, "showed", "agent-1");

    const result = await service.advanceOpportunityStage("org-1", opportunity.id, "won", "agent-1");

    expect(result.opportunity.stage).toBe("won");
    expect(result.opportunity.closedAt).not.toBeNull();

    const refreshedContact = await service.getContact("org-1", contact.id);
    expect(refreshedContact?.stage).toBe("customer");
  });

  it("advanceOpportunityStage() to 'lost': sets closedAt", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    const result = await service.advanceOpportunityStage(
      "org-1",
      opportunity.id,
      "lost",
      "agent-1",
    );

    expect(result.opportunity.stage).toBe("lost");
    expect(result.opportunity.closedAt).not.toBeNull();
  });

  it("recordRevenue() — creates event, updates opp revenueTotal, auto-advances showed→won", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    // Advance to "showed"
    await service.advanceOpportunityStage("org-1", opportunity.id, "qualified", "agent-1");
    await service.advanceOpportunityStage("org-1", opportunity.id, "booked", "agent-1");
    await service.advanceOpportunityStage("org-1", opportunity.id, "showed", "agent-1");

    const result = await service.recordRevenue({
      organizationId: "org-1",
      contactId: contact.id,
      opportunityId: opportunity.id,
      amount: 5000,
      type: "payment",
      recordedBy: "stripe",
    });

    expect(result.revenueEvent.amount).toBe(5000);
    expect(result.revenueData.amount).toBe(5000);
    expect(result.revenueData.currency).toBe("SGD");
    expect(result.stageAdvancement).not.toBeNull();
    expect(result.stageAdvancement?.opportunity.stage).toBe("won");

    const updatedOpp = await opportunityStore.findById("org-1", opportunity.id);
    expect(updatedOpp?.revenueTotal).toBeGreaterThan(0);
  });

  it("recordRevenue() — from 'booked' stage: records revenue but does NOT auto-advance", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    // Advance to "booked" (not "showed")
    await service.advanceOpportunityStage("org-1", opportunity.id, "qualified", "agent-1");
    await service.advanceOpportunityStage("org-1", opportunity.id, "booked", "agent-1");

    const result = await service.recordRevenue({
      organizationId: "org-1",
      contactId: contact.id,
      opportunityId: opportunity.id,
      amount: 5000,
      type: "deposit",
      recordedBy: "owner",
    });

    expect(result.revenueEvent.amount).toBe(5000);
    expect(result.stageAdvancement).toBeNull(); // No auto-advancement

    const updatedOpp = await opportunityStore.findById("org-1", opportunity.id);
    expect(updatedOpp?.stage).toBe("booked");
  });

  it("reopenOpportunity() — within window: succeeds", async () => {
    const contact = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const opportunity = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact.id,
      serviceId: "service-1",
      serviceName: "Haircut",
    });

    // Advance to "lost"
    await service.advanceOpportunityStage("org-1", opportunity.id, "lost", "agent-1");

    const reopened = await service.reopenOpportunity("org-1", opportunity.id, "interested");

    expect(reopened.stage).toBe("interested");
    expect(reopened.closedAt).toBeNull();
  });

  it("getPipeline() — returns stage counts and totals", async () => {
    const contact1 = await service.createContact({
      organizationId: "org-1",
      name: "Jane Doe",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });

    const contact2 = await service.createContact({
      organizationId: "org-1",
      name: "John Smith",
      phone: "+6591234568",
      primaryChannel: "telegram",
    });

    await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact1.id,
      serviceId: "service-1",
      serviceName: "Haircut",
      estimatedValue: 5000,
    });

    const opp2 = await service.createOpportunity({
      organizationId: "org-1",
      contactId: contact2.id,
      serviceId: "service-2",
      serviceName: "Massage",
      estimatedValue: 10000,
    });

    await service.advanceOpportunityStage("org-1", opp2.id, "qualified", "agent-1");

    const pipeline = await service.getPipeline("org-1");

    expect(pipeline.organizationId).toBe("org-1");
    expect(pipeline.totalContacts).toBe(2);
    expect(pipeline.stages).toEqual(
      expect.arrayContaining([
        { stage: "interested", count: 1, totalValue: 5000 },
        { stage: "qualified", count: 1, totalValue: 10000 },
      ]),
    );
  });
});
