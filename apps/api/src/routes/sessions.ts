import type { FastifyPluginAsync } from "fastify";
import { CreateSessionRequestSchema } from "@switchboard/schemas";
import { assertOrgAccess } from "../utils/org-access.js";
import { issueSessionToken } from "../auth/session-token.js";

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sessions — Create a new agent session
  app.post(
    "/",
    {
      schema: {
        description: "Create a new agent session.",
        tags: ["Sessions"],
      },
    },
    async (request, reply) => {
      if (!app.sessionManager) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const parsed = CreateSessionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues });
      }
      const body = parsed.data;

      if (!assertOrgAccess(request, body.organizationId, reply)) return;

      // Role manifests removed — use safe defaults for legacy session creation
      const manifestDefaults = {
        safetyEnvelope: {
          sessionTimeoutMs: 300_000,
          maxToolCalls: 50,
          maxMutations: 10,
          maxDollarsAtRisk: 100,
        },
        toolPack: [] as string[],
        governanceProfile: "default",
      };

      try {
        const { session, run } = await app.sessionManager.createSession({
          organizationId: body.organizationId,
          roleId: body.roleId,
          principalId: body.principalId,
          manifestDefaults,
          safetyEnvelopeOverride: body.safetyEnvelopeOverride,
          maxConcurrentSessionsForRole: 10,
        });

        // Issue session-scoped token
        const sessionTokenSecret = process.env["SESSION_TOKEN_SECRET"];
        let sessionToken: string | undefined;
        if (sessionTokenSecret) {
          sessionToken = await issueSessionToken({
            sessionId: session.id,
            organizationId: session.organizationId,
            principalId: session.principalId,
            roleId: session.roleId,
            secret: sessionTokenSecret,
            expiresInMs: session.safetyEnvelope.sessionTimeoutMs,
          });
        }

        return reply.code(201).send({
          session,
          runId: run.id,
          sessionToken,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("Concurrent session limit")) {
          return reply.code(429).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // GET /api/sessions/:id — Get session details
  app.get(
    "/:id",
    {
      schema: {
        description: "Get session details by ID.",
        tags: ["Sessions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      if (!app.sessionManager) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const { id } = request.params as { id: string };
      const session = await app.sessionManager.getSession(id);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      if (!assertOrgAccess(request, session.organizationId, reply)) return;

      return reply.code(200).send({ session });
    },
  );

  // POST /api/sessions/:id/cancel — Cancel a session
  app.post(
    "/:id/cancel",
    {
      schema: {
        description: "Cancel an active session.",
        tags: ["Sessions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      if (!app.sessionManager) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const { id } = request.params as { id: string };
      const session = await app.sessionManager.getSession(id);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      if (!assertOrgAccess(request, session.organizationId, reply)) return;

      try {
        await app.sessionManager.cancelSession(id);
        const updated = await app.sessionManager.getSession(id);
        return reply.code(200).send({ session: updated });
      } catch (err) {
        if (err instanceof Error && err.name === "SessionTransitionError") {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};
