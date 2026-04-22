import type { FastifyPluginAsync } from "fastify";
import { PlaybookSchema, createEmptyPlaybook } from "@switchboard/schemas";

const playbookRoutes: FastifyPluginAsync = async (app) => {
  if (!app.prisma) {
    app.log.warn("Prisma not available — playbook routes disabled");
    return;
  }

  app.get("/api/playbook", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });

    if (!app.prisma)
      return reply.code(503).send({ error: "Database unavailable", statusCode: 503 });

    const config = await app.prisma.organizationConfig.findUnique({
      where: { id: orgId },
      select: { onboardingPlaybook: true, onboardingStep: true, onboardingComplete: true },
    });

    if (!config) return reply.code(404).send({ error: "Org not found", statusCode: 404 });

    const playbook = config.onboardingPlaybook
      ? PlaybookSchema.parse(config.onboardingPlaybook)
      : createEmptyPlaybook();

    return reply.send({
      playbook,
      step: config.onboardingStep,
      complete: config.onboardingComplete,
    });
  });

  app.patch("/api/playbook", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });

    if (!app.prisma)
      return reply.code(503).send({ error: "Database unavailable", statusCode: 503 });

    const body = request.body as { playbook?: unknown; step?: number };
    const updates: Record<string, unknown> = {};

    if (body.playbook !== undefined) {
      const parsed = PlaybookSchema.safeParse(body.playbook);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid playbook", issues: parsed.error.issues, statusCode: 400 });
      }
      updates.onboardingPlaybook = parsed.data;
    }

    if (body.step !== undefined) {
      if (typeof body.step !== "number" || body.step < 1 || body.step > 4) {
        return reply.code(400).send({ error: "Step must be 1-4", statusCode: 400 });
      }
      updates.onboardingStep = body.step;
    }

    const config = await app.prisma.organizationConfig.update({
      where: { id: orgId },
      data: updates,
    });

    return reply.send({
      playbook: config.onboardingPlaybook
        ? PlaybookSchema.parse(config.onboardingPlaybook)
        : createEmptyPlaybook(),
      step: config.onboardingStep,
    });
  });
};

export { playbookRoutes };
