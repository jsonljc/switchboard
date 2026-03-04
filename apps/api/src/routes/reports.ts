import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const clinicReportQuerySchema = z.object({
  organizationId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  const prisma = app.prisma as any;

  // GET /api/reports/clinic — clinic performance metrics
  app.get("/clinic", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

    const parsed = clinicReportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.format() });
    }

    const orgId = parsed.data.organizationId ?? request.organizationIdFromAuth ?? "default";
    const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : new Date();
    const startDate = parsed.data.startDate
      ? new Date(parsed.data.startDate)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // default 30 days

    const dateFilter = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    const orgFilter = { organizationId: orgId };

    // 1. Lead count by stage
    const dealsByStage = await prisma.crmDeal.groupBy({
      by: ["stage"],
      where: { ...orgFilter, ...dateFilter },
      _count: { id: true },
      _sum: { amount: true },
    });

    const leadsByStage = dealsByStage.map(
      (g: { stage: string; _count: { id: number }; _sum: { amount: number | null } }) => ({
        stage: g.stage,
        count: g._count.id,
        totalValue: g._sum.amount ?? 0,
      }),
    );

    // 2. Booking count (deals at consultation_booked stage or with booking-related stages)
    const bookingStages = ["consultation_booked", "booked", "appointment_scheduled"];
    const bookingCount = dealsByStage
      .filter((g: { stage: string }) => bookingStages.includes(g.stage))
      .reduce((sum: number, g: { _count: { id: number } }) => sum + g._count.id, 0);

    // 3. Response time metrics (from ConversationState.firstReplyAt)
    const conversations = await prisma.conversationState.findMany({
      where: {
        ...orgFilter,
        firstReplyAt: { not: null },
        lastActivityAt: { gte: startDate, lte: endDate },
      },
      select: {
        firstReplyAt: true,
        messages: true,
      },
    });

    let responseTimeMetrics: {
      averageMs: number | null;
      p50Ms: number | null;
      p95Ms: number | null;
      sampleSize: number;
    } = { averageMs: null, p50Ms: null, p95Ms: null, sampleSize: 0 };

    if (conversations.length > 0) {
      const responseTimes: number[] = [];
      for (const conv of conversations) {
        // Parse first user message timestamp from messages JSON
        let messages: Array<{ role: string; timestamp: string }> = [];
        try {
          messages =
            typeof conv.messages === "string" ? JSON.parse(conv.messages) : (conv.messages ?? []);
        } catch {
          continue;
        }
        const firstUserMsg = messages.find((m: { role: string }) => m.role === "user");
        if (firstUserMsg && conv.firstReplyAt) {
          const userMsgTime = new Date(firstUserMsg.timestamp).getTime();
          const replyTime = new Date(conv.firstReplyAt).getTime();
          const diff = replyTime - userMsgTime;
          if (diff >= 0) {
            responseTimes.push(diff);
          }
        }
      }

      if (responseTimes.length > 0) {
        responseTimes.sort((a, b) => a - b);
        const avg = responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
        const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)]!;
        const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)]!;

        responseTimeMetrics = {
          averageMs: Math.round(avg),
          p50Ms: p50,
          p95Ms: p95,
          sampleSize: responseTimes.length,
        };
      }
    }

    // 4. Total leads (contacts created in period)
    const totalLeads = await prisma.crmContact.count({
      where: { ...orgFilter, ...dateFilter },
    });

    // 5. Audit-based booking events (alternative count from audit trail)
    const bookingAuditCount = await prisma.auditEntry.count({
      where: {
        ...orgFilter,
        eventType: "action.executed",
        entityType: { in: ["patient-engagement.appointment.book"] },
        timestamp: { gte: startDate, lte: endDate },
      },
    });

    return reply.send({
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      organizationId: orgId,
      leads: {
        total: totalLeads,
        byStage: leadsByStage,
      },
      bookings: {
        count: bookingCount || bookingAuditCount,
        fromDeals: bookingCount,
        fromAudit: bookingAuditCount,
      },
      responseTime: responseTimeMetrics,
    });
  });
};
