import { describe, expect, it, vi } from "vitest";
import { PrismaReEngagementVerdictReader } from "../prisma-re-engagement-verdict-reader.js";

describe("PrismaReEngagementVerdictReader.findReEngagementVerdict", () => {
  it("returns null when thread doesn't exist", async () => {
    const prisma = {
      conversationThread: { findUnique: vi.fn().mockResolvedValue(null) },
      governanceVerdict: { findFirst: vi.fn() },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    expect(await reader.findReEngagementVerdict("thread-1", new Date(), 7)).toBeNull();
    expect(prisma.governanceVerdict.findFirst).not.toHaveBeenCalled();
  });

  it("uses agentContext.sessionId as conversationId when present", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const decidedAt = new Date("2026-05-09T09:00:00Z");
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ agentContext: { sessionId: "wa-+6591234567" } }),
      },
      governanceVerdict: {
        findFirst: vi.fn().mockResolvedValue({
          id: "v-1",
          decidedAt,
          details: {
            intentClass: "re-engagement-offer",
            metaTemplateName: "re_engagement_offer_sg_v1",
          },
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    const result = await reader.findReEngagementVerdict("thread-1", inboundAt, 7);
    expect(result?.verdictId).toBe("v-1");
    expect(result?.templateName).toBe("re_engagement_offer_sg_v1");
    const callArg = prisma.governanceVerdict.findFirst.mock.calls[0]?.[0] as {
      where: { conversationId: string };
    };
    expect(callArg.where.conversationId).toBe("wa-+6591234567");
  });

  it("falls back to threadId as conversationId when agentContext.sessionId is absent", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ agentContext: {} }),
      },
      governanceVerdict: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    await reader.findReEngagementVerdict("thread-1", inboundAt, 7);
    const callArg = prisma.governanceVerdict.findFirst.mock.calls[0]?.[0] as {
      where: { conversationId: string };
    };
    expect(callArg.where.conversationId).toBe("thread-1");
  });

  it("falls back to threadId as conversationId when agentContext.sessionId is an empty string", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ agentContext: { sessionId: "" } }),
      },
      governanceVerdict: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    await reader.findReEngagementVerdict("thread-1", inboundAt, 7);
    const callArg = prisma.governanceVerdict.findFirst.mock.calls[0]?.[0] as {
      where: { conversationId: string };
    };
    expect(callArg.where.conversationId).toBe("thread-1");
  });

  it("falls back to threadId when agentContext is null (Cat 3.16 null guard)", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ agentContext: null }),
      },
      governanceVerdict: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    await reader.findReEngagementVerdict("thread-1", inboundAt, 7);
    const callArg = prisma.governanceVerdict.findFirst.mock.calls[0]?.[0] as {
      where: { conversationId: string };
    };
    expect(callArg.where.conversationId).toBe("thread-1");
  });

  it("falls back to threadId when agentContext is a non-object JSON value", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const prisma = {
      conversationThread: {
        // JSON columns can hold arrays/primitives — guard must not treat them as records.
        findUnique: vi.fn().mockResolvedValue({ agentContext: ["sessionId", "spoofed"] }),
      },
      governanceVerdict: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    await reader.findReEngagementVerdict("thread-1", inboundAt, 7);
    const callArg = prisma.governanceVerdict.findFirst.mock.calls[0]?.[0] as {
      where: { conversationId: string };
    };
    expect(callArg.where.conversationId).toBe("thread-1");
  });

  it("returns empty templateName when details.metaTemplateName is not a string", async () => {
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ agentContext: { sessionId: "s-1" } }),
      },
      governanceVerdict: {
        findFirst: vi.fn().mockResolvedValue({
          id: "v-2",
          decidedAt: new Date("2026-05-09T09:00:00Z"),
          details: { intentClass: "re-engagement-offer", metaTemplateName: 42 },
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    const result = await reader.findReEngagementVerdict("thread-1", new Date(), 7);
    expect(result?.templateName).toBe("");
  });

  it("returns null when no matching verdict exists", async () => {
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ agentContext: { sessionId: "s-1" } }),
      },
      governanceVerdict: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    expect(await reader.findReEngagementVerdict("thread-1", new Date(), 7)).toBeNull();
  });
});
