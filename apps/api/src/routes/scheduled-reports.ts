import type { FastifyPluginAsync } from "fastify";

import { z } from "zod";
import { requireOrganizationScope } from "../utils/require-org.js";

const cronRegex = /^(\S+\s+){4}\S+$/;

const createReportSchema = z.object({
  name: z.string().min(1).max(200),
  cronExpression: z
    .string()
    .refine((v) => cronRegex.test(v), { message: "Invalid cron expression" }),
  timezone: z.string().default("UTC"),
  reportType: z.enum(["funnel", "portfolio", "clinic"]),
  platform: z.string().nullish(),
  vertical: z.string().default("commerce"),
  deliveryChannels: z.array(z.string()).default([]),
  deliveryTargets: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

const updateReportSchema = createReportSchema.partial();

function computeNextRunAt(cronExpression: string, timezone: string): Date | null {
  try {
    // Dynamic import at route level — cron-parser is an optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const CronParser = require("cron-parser");
    const interval = CronParser.parseExpression(cronExpression, {
      currentDate: new Date(),
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export const scheduledReportsRoutes: FastifyPluginAsync = async (app) => {
  const prisma = app.prisma as any;

  // GET /api/scheduled-reports — list reports for org
  app.get("/", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const reports = await prisma.scheduledReport.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ reports });
  });

  // POST /api/scheduled-reports — create report
  app.post("/", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.format() });
    }

    const nextRunAt = computeNextRunAt(parsed.data.cronExpression, parsed.data.timezone);
    const report = await prisma.scheduledReport.create({
      data: { ...parsed.data, organizationId: orgId, nextRunAt },
    });
    return reply.code(201).send({ report });
  });

  // PUT /api/scheduled-reports/:id — update report
  app.put("/:id", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const parsed = updateReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.format() });
    }

    const existing = await prisma.scheduledReport.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return reply.code(404).send({ error: "Scheduled report not found" });

    const data: Record<string, unknown> = { ...parsed.data };

    // Recompute nextRunAt if cron changed
    if (parsed.data.cronExpression || parsed.data.timezone) {
      const cron = parsed.data.cronExpression ?? existing.cronExpression;
      const tz = parsed.data.timezone ?? existing.timezone;
      data.nextRunAt = computeNextRunAt(cron, tz);
    }

    const report = await prisma.scheduledReport.update({ where: { id }, data });
    return reply.send({ report });
  });

  // DELETE /api/scheduled-reports/:id — delete report
  app.delete("/:id", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const existing = await prisma.scheduledReport.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return reply.code(404).send({ error: "Scheduled report not found" });
    await prisma.scheduledReport.delete({ where: { id } });
    return reply.send({ id, deleted: true });
  });

  // POST /api/scheduled-reports/:id/run — manually trigger report
  app.post("/:id/run", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const report = await prisma.scheduledReport.findFirst({ where: { id, organizationId: orgId } });
    if (!report) return reply.code(404).send({ error: "Scheduled report not found" });

    try {
      const vertical = report.vertical ?? "commerce";
      const cartridgeId = resolveCartridgeForVertical(vertical);

      const cartridge = app.storageContext.cartridges.get(cartridgeId);
      if (!cartridge)
        return reply.code(400).send({ error: `${cartridgeId} cartridge not registered` });

      const actionId = resolveDiagnoseAction(cartridgeId, report.reportType);

      const executeCapable = cartridge as unknown as {
        execute?: (id: string, p: unknown) => Promise<{ data: unknown }>;
      };
      if (typeof executeCapable.execute !== "function") {
        return reply.code(501).send({ error: `${cartridgeId} cartridge does not support execute` });
      }

      const result = await executeCapable.execute(actionId, {
        platform: report.platform ?? "meta",
        vertical: report.vertical,
        entityId: "act_default",
      });

      // Update lastRunAt and nextRunAt
      const nextRunAt = computeNextRunAt(report.cronExpression, report.timezone);
      await prisma.scheduledReport.update({
        where: { id },
        data: { lastRunAt: new Date(), nextRunAt },
      });

      return reply.send({ success: true, data: result?.data ?? null });
    } catch (err: any) {
      app.log.error({ err, reportId: id }, "Manual report run failed");
      return reply.code(500).send({ error: "Report run failed", detail: err.message });
    }
  });
};

/** Map vertical identifiers to their corresponding cartridge ID. */
function resolveCartridgeForVertical(vertical: string): string {
  switch (vertical) {
    case "clinic":
    case "healthcare":
    case "dental":
      return "customer-engagement";
    default:
      return "digital-ads";
  }
}

/** Resolve the diagnostic action ID for a given cartridge and report type. */
function resolveDiagnoseAction(cartridgeId: string, reportType: string): string {
  if (cartridgeId === "customer-engagement") {
    return "customer-engagement.pipeline.diagnose";
  }
  return reportType === "portfolio"
    ? "digital-ads.portfolio.diagnose"
    : "digital-ads.funnel.diagnose";
}
