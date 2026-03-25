import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Contact, Opportunity, OwnerTask, FallbackReason } from "@switchboard/schemas";
import type { Message } from "../../conversation-store.js";
import type { OwnerTaskStore, CreateOwnerTaskInput } from "../owner-task-store.js";
import { DEFAULT_STAGE_HANDLER_MAP } from "../stage-handler-map.js";
import { FallbackHandler } from "../fallback-handler.js";
import type { FallbackContext } from "../fallback-handler.js";

describe("FallbackHandler", () => {
  let taskStore: OwnerTaskStore;
  let handler: FallbackHandler;
  let createdTasks: OwnerTask[];

  beforeEach(() => {
    createdTasks = [];

    taskStore = {
      create: vi.fn().mockImplementation(async (input: CreateOwnerTaskInput) => {
        const task: OwnerTask = {
          id: `task-${createdTasks.length + 1}`,
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
          createdAt: new Date(),
        };
        createdTasks.push(task);
        return task;
      }),
      findPending: vi.fn(),
      updateStatus: vi.fn(),
      autoComplete: vi.fn(),
    };

    handler = new FallbackHandler({
      ownerTaskStore: taskStore,
      stageHandlerMap: DEFAULT_STAGE_HANDLER_MAP,
      slaConfig: { urgent: 4, high: 12, medium: 24, low: 72 },
      highValueThreshold: 100_000,
    });
  });

  const createContact = (overrides: Partial<Contact> = {}): Contact => ({
    id: "contact-1",
    organizationId: "org-1",
    name: "John Doe",
    phone: "+6512345678",
    email: "john@example.com",
    primaryChannel: "whatsapp",
    firstTouchChannel: "whatsapp",
    stage: "new",
    source: null,
    attribution: null,
    roles: ["lead"],
    firstContactAt: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
    id: "opp-1",
    organizationId: "org-1",
    contactId: "contact-1",
    serviceId: "service-1",
    serviceName: "Laser Hair Removal",
    stage: "interested",
    timeline: "soon",
    priceReadiness: "ready",
    objections: [],
    qualificationComplete: false,
    estimatedValue: null,
    revenueTotal: 0,
    assignedAgent: null,
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMessage = (direction: "inbound" | "outbound", content: string): Message => ({
    id: `msg-${Date.now()}`,
    contactId: "contact-1",
    direction,
    content,
    timestamp: new Date().toISOString(),
    channel: "whatsapp",
    metadata: {},
  });

  it("creates OwnerTask with correct type, title, description from event context", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity(),
      recentMessages: [
        createMessage("inbound", "Hi, interested in laser hair removal"),
        createMessage("outbound", "Great! Let me help you with that."),
      ],
      missingCapability: "lead-responder",
      fallbackReason: "paused",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task).toBeDefined();
    expect(result.task?.type).toBe("fallback_handoff");
    expect(result.task?.title).toContain("John Doe");
    expect(result.task?.title).toContain("Laser Hair Removal");
    expect(result.task?.title).toContain("no lead-responder");
    expect(result.task?.description).toContain("Contact: John Doe");
    expect(result.task?.description).toContain("Service: Laser Hair Removal");
    expect(result.task?.description).toContain("Stage: interested");
    expect(result.task?.description).toContain("Reason: agent paused");
  });

  it("returns null task for booked stage (fallbackType: none)", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity({ stage: "booked" }),
      recentMessages: [],
      missingCapability: "system",
      fallbackReason: "not_configured",
    };

    const result = await handler.handleUnrouted(context);

    // Booked stage has fallbackType: "none" in DEFAULT_STAGE_HANDLER_MAP
    expect(result.task).toBeNull();
    expect(result.notifications).toEqual([]);
  });

  it("sets priority to urgent for showed stage", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity({ stage: "showed" }),
      recentMessages: [],
      missingCapability: "revenue-tracker",
      fallbackReason: "errored",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task?.priority).toBe("urgent");
  });

  it("sets priority to high for qualified stage with high value", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity({ stage: "qualified", estimatedValue: 150_000 }),
      recentMessages: [],
      missingCapability: "sales-closer",
      fallbackReason: "paused",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task?.priority).toBe("high");
  });

  it("sets priority to medium for qualified stage with low value", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity({ stage: "qualified", estimatedValue: 50_000 }),
      recentMessages: [],
      missingCapability: "sales-closer",
      fallbackReason: "paused",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task?.priority).toBe("medium");
  });

  it("sets priority to low for interested stage", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity({ stage: "interested" }),
      recentMessages: [],
      missingCapability: "lead-responder",
      fallbackReason: "not_configured",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task?.priority).toBe("low");
  });

  it("sets dueAt based on fallback SLA config", async () => {
    const before = Date.now();

    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity({ stage: "showed" }),
      recentMessages: [],
      missingCapability: "revenue-tracker",
      fallbackReason: "errored",
    };

    const result = await handler.handleUnrouted(context);

    const after = Date.now();
    const dueAt = result.task?.dueAt?.getTime();
    expect(dueAt).toBeDefined();

    // Showed stage = urgent priority = 4 hours
    const expectedMin = before + 4 * 60 * 60 * 1000;
    const expectedMax = after + 4 * 60 * 60 * 1000;

    expect(dueAt).toBeGreaterThanOrEqual(expectedMin);
    expect(dueAt).toBeLessThanOrEqual(expectedMax);
  });

  it("includes fallback reason in task", async () => {
    const reasons: FallbackReason[] = ["not_configured", "paused", "errored"];

    for (const reason of reasons) {
      const context: FallbackContext = {
        contact: createContact(),
        opportunity: createOpportunity(),
        recentMessages: [],
        missingCapability: "lead-responder",
        fallbackReason: reason,
      };

      const result = await handler.handleUnrouted(context);

      expect(result.task?.fallbackReason).toBe(reason);
      expect(result.task?.description).toContain(`agent ${reason}`);
    }
  });

  it("returns dashboard notification", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity(),
      recentMessages: [],
      missingCapability: "lead-responder",
      fallbackReason: "paused",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].channel).toBe("dashboard");
    expect(result.notifications[0].recipientId).toBe("org-1");
    expect(result.notifications[0].message).toContain("John Doe");
    expect(result.notifications[0].message).toContain("needs attention");
  });

  it("handles context with no opportunity (null opportunity)", async () => {
    const context: FallbackContext = {
      contact: createContact({ name: "Jane Smith" }),
      opportunity: null,
      recentMessages: [createMessage("inbound", "Hello, I have a question")],
      missingCapability: "lead-responder",
      fallbackReason: "not_configured",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task).toBeDefined();
    expect(result.task?.priority).toBe("low");
    expect(result.task?.title).toContain("Jane Smith");
    expect(result.task?.title).toContain("general inquiry");
    expect(result.task?.description).toContain("Contact: Jane Smith");
    expect(result.task?.description).not.toContain("Service:");
    expect(result.task?.suggestedAction).toBe("Review lead and respond");
  });

  it("includes recent messages in description (last 3)", async () => {
    const context: FallbackContext = {
      contact: createContact(),
      opportunity: createOpportunity(),
      recentMessages: [
        createMessage("inbound", "Message 1"),
        createMessage("outbound", "Message 2"),
        createMessage("inbound", "Message 3"),
        createMessage("outbound", "Message 4"),
        createMessage("inbound", "Message 5"),
      ],
      missingCapability: "lead-responder",
      fallbackReason: "paused",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.task?.description).toContain("Recent messages:");
    expect(result.task?.description).toContain("Message 3");
    expect(result.task?.description).toContain("Message 4");
    expect(result.task?.description).toContain("Message 5");
    expect(result.task?.description).not.toContain("Message 1");
    expect(result.task?.description).not.toContain("Message 2");
  });

  it("builds suggested action based on opportunity stage", async () => {
    const testCases: Array<{
      stage: Opportunity["stage"];
      expectedAction: string;
    }> = [
      { stage: "interested", expectedAction: "Respond to inquiry about Laser Hair Removal" },
      {
        stage: "qualified",
        expectedAction: "Follow up — lead is qualified for Laser Hair Removal, timeline:",
      },
      { stage: "quoted", expectedAction: "Follow up on quote for Laser Hair Removal" },
      { stage: "showed", expectedAction: "Record payment for Laser Hair Removal" },
    ];

    for (const testCase of testCases) {
      const context: FallbackContext = {
        contact: createContact(),
        opportunity: createOpportunity({ stage: testCase.stage }),
        recentMessages: [],
        missingCapability: "lead-responder",
        fallbackReason: "paused",
      };

      const result = await handler.handleUnrouted(context);

      expect(result.task?.suggestedAction).toContain(testCase.expectedAction);
    }
  });

  it("sets contact name to Unknown lead when name is null", async () => {
    const context: FallbackContext = {
      contact: createContact({ name: null }),
      opportunity: createOpportunity(),
      recentMessages: [],
      missingCapability: "lead-responder",
      fallbackReason: "paused",
    };

    const result = await handler.handleUnrouted(context);

    expect(result.notifications[0].message).toContain("New lead");
    expect(result.task?.title).toContain("Unknown lead");
  });
});
