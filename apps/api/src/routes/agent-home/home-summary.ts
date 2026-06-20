// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { PrismaConversionRecordStore } from "@switchboard/db";
import { buildHomeSummary, type HomeSummarySignals } from "@switchboard/core";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { requireOrganizationScope } from "../../utils/require-org.js";

export const homeSummaryRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/home/summary", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const prisma = app.prisma;
    if (!prisma) return reply.code(200).send({ summary: unavailableSummary(new Date()) });

    const timezone = await getOrgTimezone(prisma, orgId);
    const conversions = new PrismaConversionRecordStore(prisma);
    const signals: HomeSummarySignals = {
      sumAttributedBookedValueCentsForWindow: (i) =>
        conversions.sumAttributedBookedValueCentsForWindow(i),
      countBookedConversionsForWindow: (i) => conversions.countBookedConversionsForWindow(i),
    };

    try {
      const summary = await buildHomeSummary({ orgId, now: new Date(), timezone, signals });
      return reply.code(200).send({ summary });
    } catch (err) {
      app.log.error({ err }, "home summary projection failed");
      return reply.code(500).send({ error: "Home summary projection failed" });
    }
  });
};

function unavailableSummary(now: Date) {
  const generatedAt = now.toISOString();
  return {
    attributedValueCents: { state: "unavailable" as const, reason: "store_unavailable" },
    bookings: { state: "unavailable" as const, reason: "store_unavailable" },
    currency: "SGD" as const,
    generatedAt,
  };
}
