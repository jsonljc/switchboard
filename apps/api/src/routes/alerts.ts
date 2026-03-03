import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const VALID_OPERATORS = ["gt", "gte", "lt", "lte", "eq", "pctChange_gt", "pctChange_lt"] as const;

const VALID_METRIC_PATHS = [
  "primaryKPI.current",
  "primaryKPI.deltaPercent",
  "spend.current",
  "findings.critical.count",
  "findings.warning.count",
  "bottleneck.deltaPercent",
] as const;

const createAlertSchema = z.object({
  name: z.string().min(1).max(200),
  metricPath: z.enum(VALID_METRIC_PATHS),
  operator: z.enum(VALID_OPERATORS),
  threshold: z.number(),
  platform: z.string().nullish(),
  vertical: z.string().default("commerce"),
  notifyChannels: z.array(z.string()).default([]),
  notifyRecipients: z.array(z.string()).default([]),
  cooldownMinutes: z.number().int().min(1).default(60),
  enabled: z.boolean().default(true),
});

const updateAlertSchema = createAlertSchema.partial().extend({
  snoozedUntil: z.string().datetime().nullish(),
});

export const alertsRoutes: FastifyPluginAsync = async (app) => {
  // Cast to any — the generated Prisma client knows about AlertRule/AlertHistory
  // but the re-exported PrismaClient type from @switchboard/db may lag behind.
  const prisma = app.prisma as any;

  // GET /api/alerts — list alert rules for the org
  app.get("/", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = request.organizationIdFromAuth ?? "default";
    const rules = await prisma.alertRule.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ rules });
  });

  // POST /api/alerts — create alert rule
  app.post("/", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = request.organizationIdFromAuth ?? "default";
    const parsed = createAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.format() });
    }
    const rule = await prisma.alertRule.create({
      data: { ...parsed.data, organizationId: orgId },
    });
    return reply.code(201).send({ rule });
  });

  // PUT /api/alerts/:id — update alert rule
  app.put("/:id", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth ?? "default";
    const parsed = updateAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.format() });
    }
    const existing = await prisma.alertRule.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "Alert rule not found" });

    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.snoozedUntil !== undefined) {
      data.snoozedUntil = parsed.data.snoozedUntil ? new Date(parsed.data.snoozedUntil) : null;
    }

    const rule = await prisma.alertRule.update({ where: { id }, data });
    return reply.send({ rule });
  });

  // DELETE /api/alerts/:id — delete alert rule
  app.delete("/:id", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth ?? "default";
    const existing = await prisma.alertRule.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "Alert rule not found" });
    await prisma.alertRule.delete({ where: { id } });
    return reply.send({ id, deleted: true });
  });

  // POST /api/alerts/:id/test — dry-run evaluation
  app.post("/:id/test", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth ?? "default";
    const rule = await prisma.alertRule.findFirst({ where: { id, organizationId: orgId } });
    if (!rule) return reply.code(404).send({ error: "Alert rule not found" });

    try {
      const { evaluateAlertRule } = await import("../alerts/evaluator.js");
      const cartridge = app.storageContext.cartridges.get("digital-ads");
      if (!cartridge)
        return reply.code(400).send({ error: "digital-ads cartridge not registered" });

      const result = await cartridge.execute(
        "digital-ads.funnel.diagnose",
        {
          platform: rule.platform ?? "meta",
          vertical: rule.vertical,
          entityId: "act_default",
        },
        { principalId: "system", organizationId: orgId, connectionCredentials: {} },
      );

      if (!result?.data) {
        return reply.send({ triggered: false, error: "No diagnostic data returned" });
      }

      const evaluation = evaluateAlertRule(
        { metricPath: rule.metricPath, operator: rule.operator, threshold: rule.threshold },
        result.data as Record<string, unknown>,
      );
      return reply.send({ evaluation, rule: { id: rule.id, name: rule.name } });
    } catch (err: any) {
      app.log.error({ err, alertRuleId: id }, "Alert test failed");
      return reply.code(500).send({ error: "Test failed", detail: err.message });
    }
  });

  // GET /api/alerts/:id/history — list alert history
  app.get("/:id/history", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth ?? "default";
    const rule = await prisma.alertRule.findFirst({ where: { id, organizationId: orgId } });
    if (!rule) return reply.code(404).send({ error: "Alert rule not found" });

    const history = await prisma.alertHistory.findMany({
      where: { alertRuleId: id },
      orderBy: { triggeredAt: "desc" },
      take: 100,
    });
    return reply.send({ history });
  });

  // POST /api/alerts/:id/snooze — temporarily silence
  app.post("/:id/snooze", async (request, reply) => {
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth ?? "default";
    const body = request.body as { durationMinutes?: number };
    const minutes = body.durationMinutes ?? 60;

    const existing = await prisma.alertRule.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "Alert rule not found" });

    const snoozedUntil = new Date(Date.now() + minutes * 60_000);
    const rule = await prisma.alertRule.update({ where: { id }, data: { snoozedUntil } });
    return reply.send({ rule });
  });
};
