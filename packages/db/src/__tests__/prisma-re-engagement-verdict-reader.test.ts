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
