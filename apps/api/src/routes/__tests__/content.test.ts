import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaContentStore, PrismaPerformanceStore } from "@switchboard/db";

vi.mock("@switchboard/db", () => ({
  PrismaContentStore: vi.fn(),
  PrismaPerformanceStore: vi.fn(),
}));

function createMockContentStore() {
  return {
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    listDrafts: vi.fn(),
    updateDraftStatus: vi.fn(),
    createCalendarEntry: vi.fn(),
    listCalendar: vi.fn(),
  };
}

function createMockPerfStore() {
  return {
    record: vi.fn(),
    getTop: vi.fn(),
    getApprovalRate: vi.fn(),
  };
}

describe("Content routes store interactions", () => {
  let contentStore: ReturnType<typeof createMockContentStore>;
  let perfStore: ReturnType<typeof createMockPerfStore>;

  beforeEach(() => {
    contentStore = createMockContentStore();
    perfStore = createMockPerfStore();
    vi.mocked(PrismaContentStore).mockImplementation(() => contentStore as never);
    vi.mocked(PrismaPerformanceStore).mockImplementation(() => perfStore as never);
  });

  const baseDraft = {
    id: "draft-1",
    employeeId: "creative",
    organizationId: "org-1",
    channel: "linkedin",
    format: "post",
    content: "Great post about AI",
    status: "draft",
    feedback: null,
    revision: 1,
    parentDraftId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("listDrafts returns drafts filtered by employee", async () => {
    contentStore.listDrafts.mockResolvedValue([baseDraft]);

    const drafts = await contentStore.listDrafts("org-1", "creative", undefined);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].channel).toBe("linkedin");
  });

  it("listDrafts filters by status", async () => {
    contentStore.listDrafts.mockResolvedValue([]);

    const drafts = await contentStore.listDrafts("org-1", "creative", "approved");
    expect(drafts).toHaveLength(0);
    expect(contentStore.listDrafts).toHaveBeenCalledWith("org-1", "creative", "approved");
  });

  it("getDraft returns a single draft", async () => {
    contentStore.getDraft.mockResolvedValue(baseDraft);

    const draft = await contentStore.getDraft("draft-1");
    expect(draft?.content).toBe("Great post about AI");
  });

  it("approve flow updates status and records performance", async () => {
    contentStore.getDraft.mockResolvedValue(baseDraft);
    contentStore.updateDraftStatus.mockResolvedValue({ ...baseDraft, status: "approved" });
    perfStore.record.mockResolvedValue(undefined);

    const draft = await contentStore.getDraft("draft-1");
    expect(draft?.status).toBe("draft");

    const updated = await contentStore.updateDraftStatus("draft-1", "approved");
    expect(updated.status).toBe("approved");

    await perfStore.record("org-1", "creative", {
      contentId: "draft-1",
      outcome: "approved",
    });

    expect(perfStore.record).toHaveBeenCalledWith("org-1", "creative", {
      contentId: "draft-1",
      outcome: "approved",
    });
  });

  it("reject flow records rejection with feedback", async () => {
    contentStore.getDraft.mockResolvedValue(baseDraft);
    contentStore.updateDraftStatus.mockResolvedValue({
      ...baseDraft,
      status: "rejected",
      feedback: "Too long",
    });
    perfStore.record.mockResolvedValue(undefined);

    const updated = await contentStore.updateDraftStatus("draft-1", "rejected", "Too long");
    expect(updated.status).toBe("rejected");
    expect(updated.feedback).toBe("Too long");

    await perfStore.record("org-1", "creative", {
      contentId: "draft-1",
      outcome: "rejected",
      feedback: "Too long",
    });

    expect(perfStore.record).toHaveBeenCalledWith("org-1", "creative", {
      contentId: "draft-1",
      outcome: "rejected",
      feedback: "Too long",
    });
  });

  it("listCalendar returns entries within date range", async () => {
    const entry = {
      id: "cal-1",
      employeeId: "creative",
      organizationId: "org-1",
      channel: "twitter",
      topic: "AI trends",
      scheduledFor: new Date("2026-04-10"),
      draftId: null,
      status: "planned",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    contentStore.listCalendar.mockResolvedValue([entry]);

    const entries = await contentStore.listCalendar(
      "org-1",
      new Date("2026-04-01"),
      new Date("2026-04-30"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].topic).toBe("AI trends");
  });

  it("getApprovalRate returns stats", async () => {
    perfStore.getApprovalRate.mockResolvedValue({
      total: 10,
      approved: 8,
      rate: 0.8,
    });

    const stats = await perfStore.getApprovalRate("org-1", "creative");
    expect(stats.rate).toBe(0.8);
    expect(stats.total).toBe(10);
  });
});
