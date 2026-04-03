import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaContentStore } from "../prisma-content-store.js";

function makeMockPrisma() {
  return {
    contentDraft: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    contentCalendarEntry: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

const now = new Date("2026-04-01T00:00:00Z");

function makeDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    employeeId: "emp-1",
    organizationId: "org-1",
    channel: "instagram",
    format: "carousel",
    content: "Check out our latest product!",
    status: "draft",
    feedback: null,
    revision: 1,
    parentDraftId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCalendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal-1",
    employeeId: "emp-1",
    organizationId: "org-1",
    channel: "instagram",
    topic: "Product launch",
    scheduledFor: new Date("2026-04-10T09:00:00Z"),
    draftId: null,
    status: "planned",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PrismaContentStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaContentStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaContentStore(prisma as never);
  });

  describe("createDraft", () => {
    it("creates a content draft with all fields", async () => {
      const draft = makeDraftRow();
      prisma.contentDraft.create.mockResolvedValue(draft);

      const result = await store.createDraft("org-1", "emp-1", {
        channel: "instagram",
        format: "carousel",
        content: "Check out our latest product!",
      });

      expect(prisma.contentDraft.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          employeeId: "emp-1",
          organizationId: "org-1",
          channel: "instagram",
          format: "carousel",
          content: "Check out our latest product!",
          status: "draft",
          parentDraftId: null,
          revision: 1,
        }),
      });
      expect(result.id).toBe("draft-1");
    });

    it("accepts optional status and parentDraftId", async () => {
      prisma.contentDraft.create.mockResolvedValue(
        makeDraftRow({ status: "pending_review", parentDraftId: "draft-0" }),
      );

      await store.createDraft("org-1", "emp-1", {
        channel: "tiktok",
        format: "short_video",
        content: "Script for video",
        status: "pending_review",
        parentDraftId: "draft-0",
      });

      expect(prisma.contentDraft.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: "pending_review",
          parentDraftId: "draft-0",
        }),
      });
    });
  });

  describe("getDraft", () => {
    it("returns null when draft not found", async () => {
      const result = await store.getDraft("draft-999");
      expect(result).toBeNull();
    });

    it("returns draft when found", async () => {
      const draft = makeDraftRow();
      prisma.contentDraft.findFirst.mockResolvedValue(draft);

      const result = await store.getDraft("draft-1");

      expect(result).toEqual(draft);
      expect(prisma.contentDraft.findFirst).toHaveBeenCalledWith({
        where: { id: "draft-1" },
      });
    });
  });

  describe("listDrafts", () => {
    it("lists all drafts for employee without status filter", async () => {
      const drafts = [makeDraftRow(), makeDraftRow({ id: "draft-2" })];
      prisma.contentDraft.findMany.mockResolvedValue(drafts);

      const result = await store.listDrafts("org-1", "emp-1");

      expect(prisma.contentDraft.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", employeeId: "emp-1" },
        orderBy: { updatedAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by status when provided", async () => {
      prisma.contentDraft.findMany.mockResolvedValue([makeDraftRow({ status: "approved" })]);

      await store.listDrafts("org-1", "emp-1", "approved");

      expect(prisma.contentDraft.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", employeeId: "emp-1", status: "approved" },
        orderBy: { updatedAt: "desc" },
      });
    });
  });

  describe("updateDraftStatus", () => {
    it("updates draft status and feedback", async () => {
      const existing = makeDraftRow();
      prisma.contentDraft.findFirst.mockResolvedValue(existing);
      const updated = makeDraftRow({ status: "approved", feedback: "Looks good!" });
      prisma.contentDraft.update.mockResolvedValue(updated);

      const result = await store.updateDraftStatus("draft-1", "approved", "Looks good!");

      expect(prisma.contentDraft.update).toHaveBeenCalledWith({
        where: { id: "draft-1" },
        data: {
          status: "approved",
          feedback: "Looks good!",
          updatedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe("approved");
    });

    it("preserves existing feedback when not provided", async () => {
      const existing = makeDraftRow({ feedback: "Previous feedback" });
      prisma.contentDraft.findFirst.mockResolvedValue(existing);
      prisma.contentDraft.update.mockResolvedValue(
        makeDraftRow({ status: "rejected", feedback: "Previous feedback" }),
      );

      await store.updateDraftStatus("draft-1", "rejected");

      expect(prisma.contentDraft.update).toHaveBeenCalledWith({
        where: { id: "draft-1" },
        data: {
          status: "rejected",
          feedback: "Previous feedback",
          updatedAt: expect.any(Date),
        },
      });
    });

    it("throws when draft not found", async () => {
      await expect(store.updateDraftStatus("draft-999", "approved")).rejects.toThrow(/not found/);
    });
  });

  describe("createCalendarEntry", () => {
    it("creates a calendar entry", async () => {
      const entry = makeCalendarRow();
      prisma.contentCalendarEntry.create.mockResolvedValue(entry);

      const scheduledFor = new Date("2026-04-10T09:00:00Z");
      const result = await store.createCalendarEntry("org-1", "emp-1", {
        channel: "instagram",
        topic: "Product launch",
        scheduledFor,
      });

      expect(prisma.contentCalendarEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          employeeId: "emp-1",
          organizationId: "org-1",
          channel: "instagram",
          topic: "Product launch",
          scheduledFor,
          draftId: null,
          status: "planned",
        }),
      });
      expect(result.id).toBe("cal-1");
    });

    it("accepts optional draftId and status", async () => {
      prisma.contentCalendarEntry.create.mockResolvedValue(
        makeCalendarRow({ draftId: "draft-1", status: "drafted" }),
      );

      await store.createCalendarEntry("org-1", "emp-1", {
        channel: "tiktok",
        topic: "Behind the scenes",
        scheduledFor: new Date("2026-04-15T14:00:00Z"),
        draftId: "draft-1",
        status: "drafted",
      });

      expect(prisma.contentCalendarEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          draftId: "draft-1",
          status: "drafted",
        }),
      });
    });
  });

  describe("listCalendar", () => {
    it("lists all calendar entries for org without date filters", async () => {
      const entries = [makeCalendarRow(), makeCalendarRow({ id: "cal-2" })];
      prisma.contentCalendarEntry.findMany.mockResolvedValue(entries);

      const result = await store.listCalendar("org-1");

      expect(prisma.contentCalendarEntry.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        orderBy: { scheduledFor: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by scheduledAfter", async () => {
      prisma.contentCalendarEntry.findMany.mockResolvedValue([]);
      const after = new Date("2026-04-05T00:00:00Z");

      await store.listCalendar("org-1", after);

      expect(prisma.contentCalendarEntry.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          scheduledFor: { gte: after },
        },
        orderBy: { scheduledFor: "asc" },
      });
    });

    it("filters by both scheduledAfter and scheduledBefore", async () => {
      prisma.contentCalendarEntry.findMany.mockResolvedValue([]);
      const after = new Date("2026-04-01T00:00:00Z");
      const before = new Date("2026-04-30T23:59:59Z");

      await store.listCalendar("org-1", after, before);

      expect(prisma.contentCalendarEntry.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          scheduledFor: { gte: after, lte: before },
        },
        orderBy: { scheduledFor: "asc" },
      });
    });
  });
});
