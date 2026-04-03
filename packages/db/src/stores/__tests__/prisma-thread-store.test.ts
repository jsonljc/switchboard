import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationThreadStore } from "../prisma-thread-store.js";

const now = new Date("2026-03-23T12:00:00Z");

function makeMockPrisma() {
  return {
    conversationThread: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeThread(overrides: Record<string, any> = {}) {
  return {
    id: "thread-1",
    contactId: "contact-1",
    organizationId: "org-1",
    stage: "new" as const,
    threadStatus: "open" as const,
    assignedAgent: "employee-a",
    agentContext: {
      objectionsEncountered: [] as string[],
      preferencesLearned: {} as Record<string, string>,
      offersMade: [] as Array<{ description: string; date: Date }>,
      topicsDiscussed: [] as string[],
      sentimentTrend: "unknown" as const,
    },
    currentSummary: "",
    followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
    lastOutcomeAt: null,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PrismaConversationThreadStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaConversationThreadStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaConversationThreadStore(prisma as never);
  });

  describe("getByContact", () => {
    it("returns null when no thread exists", async () => {
      const result = await store.getByContact("contact-1", "org-1");
      expect(result).toBeNull();
      expect(prisma.conversationThread.findUnique).toHaveBeenCalledWith({
        where: {
          contactId_organizationId: { contactId: "contact-1", organizationId: "org-1" },
        },
      });
    });

    it("maps all fields from Prisma row", async () => {
      const row = makeThread({
        stage: "responding",
        agentContext: {
          objectionsEncountered: ["too expensive"],
          preferencesLearned: { time: "morning" },
          offersMade: [{ description: "10% off", date: now }],
          topicsDiscussed: ["pricing"],
          sentimentTrend: "positive",
        },
        currentSummary: "Interested lead",
        messageCount: 5,
        lastOutcomeAt: now,
      });
      prisma.conversationThread.findUnique.mockResolvedValue(row);

      const result = await store.getByContact("contact-1", "org-1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("thread-1");
      expect(result!.contactId).toBe("contact-1");
      expect(result!.organizationId).toBe("org-1");
      expect(result!.stage).toBe("responding");
      expect(result!.assignedAgent).toBe("employee-a");
      expect(result!.currentSummary).toBe("Interested lead");
      expect(result!.messageCount).toBe(5);
      expect(result!.lastOutcomeAt).toEqual(now);
      expect(result!.agentContext.objectionsEncountered).toEqual(["too expensive"]);
      expect(result!.agentContext.preferencesLearned).toEqual({ time: "morning" });
      expect(result!.agentContext.offersMade).toHaveLength(1);
      expect(result!.agentContext.sentimentTrend).toBe("positive");
      expect(result!.followUpSchedule.nextFollowUpAt).toBeNull();
      expect(result!.createdAt).toEqual(now);
      expect(result!.updatedAt).toEqual(now);
    });
  });

  describe("create", () => {
    it("persists a new thread with all fields", async () => {
      const thread = makeThread();
      await store.create(thread);

      expect(prisma.conversationThread.create).toHaveBeenCalledWith({
        data: {
          id: "thread-1",
          contactId: "contact-1",
          organizationId: "org-1",
          stage: "new",
          threadStatus: "open",
          assignedAgent: "employee-a",
          agentContext: thread.agentContext,
          currentSummary: "",
          followUpSchedule: thread.followUpSchedule,
          lastOutcomeAt: null,
          messageCount: 0,
        },
      });
    });

    it("passes JSON objects for agentContext and followUpSchedule", async () => {
      const thread = makeThread({
        agentContext: {
          objectionsEncountered: ["price"],
          preferencesLearned: { day: "monday" },
          offersMade: [],
          topicsDiscussed: ["demo"],
          sentimentTrend: "neutral",
        },
        followUpSchedule: { nextFollowUpAt: now, reason: "demo scheduled", cadenceId: "cad-1" },
      });

      await store.create(thread);

      const call = prisma.conversationThread.create.mock.calls[0]![0]!;
      expect(call.data.agentContext).toEqual(thread.agentContext);
      expect(call.data.followUpSchedule).toEqual(thread.followUpSchedule);
    });
  });

  describe("update", () => {
    it("updates stage only", async () => {
      await store.update("thread-1", { stage: "qualifying" });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { stage: "qualifying" },
      });
    });

    it("updates assignedAgent only", async () => {
      await store.update("thread-1", { assignedAgent: "employee-b" });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { assignedAgent: "employee-b" },
      });
    });

    it("updates threadStatus only", async () => {
      await store.update("thread-1", { threadStatus: "waiting_on_customer" });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { threadStatus: "waiting_on_customer" },
      });
    });

    it("updates agentContext only", async () => {
      const agentContext = {
        objectionsEncountered: ["too expensive"],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: ["pricing"],
        sentimentTrend: "negative" as const,
      };
      await store.update("thread-1", { agentContext });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { agentContext },
      });
    });

    it("updates currentSummary only", async () => {
      await store.update("thread-1", { currentSummary: "Updated summary" });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { currentSummary: "Updated summary" },
      });
    });

    it("updates followUpSchedule only", async () => {
      const followUpSchedule = { nextFollowUpAt: now, reason: "check in", cadenceId: null };
      await store.update("thread-1", { followUpSchedule });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { followUpSchedule },
      });
    });

    it("updates lastOutcomeAt only", async () => {
      await store.update("thread-1", { lastOutcomeAt: now });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { lastOutcomeAt: now },
      });
    });

    it("updates messageCount only", async () => {
      await store.update("thread-1", { messageCount: 15 });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { messageCount: 15 },
      });
    });

    it("updates multiple fields at once", async () => {
      await store.update("thread-1", {
        stage: "qualified",
        assignedAgent: "employee-b",
        messageCount: 10,
        currentSummary: "Hot lead, ready to close",
      });
      expect(prisma.conversationThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: {
          stage: "qualified",
          assignedAgent: "employee-b",
          messageCount: 10,
          currentSummary: "Hot lead, ready to close",
        },
      });
    });

    it("only includes defined fields in data payload", async () => {
      await store.update("thread-1", { stage: "won" });
      const call = prisma.conversationThread.update.mock.calls[0]![0]!;
      expect(Object.keys(call.data)).toEqual(["stage"]);
    });
  });
});
