import type { FastifyPluginAsync } from "fastify";
import { CreateSessionRequestSchema, SessionRunCallbackBodySchema } from "@switchboard/schemas";
import { assertOrgAccess } from "../utils/org-access.js";
import { issueSessionToken } from "../auth/session-token.js";
import { getSessionTokenClaims, requireSessionToken } from "../auth/require-session-token.js";
import {
  RunCallbackRunNotFoundError,
  RunCallbackSessionMismatchError,
  RunCallbackSessionNotFoundError,
} from "@switchboard/db";
import { sessionCallbackBodyToGatewayResponse } from "../gateway/callback-to-response.js";

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

      // Lookup role manifest
      const loaded = app.roleManifests.get(body.roleId);
      if (!loaded) {
        return reply.code(404).send({ error: `Role '${body.roleId}' not found` });
      }

      try {
        const { session, run } = await app.sessionManager.createSession({
          organizationId: body.organizationId,
          roleId: body.roleId,
          principalId: body.principalId,
          manifestDefaults: {
            safetyEnvelope: loaded.manifest.safetyEnvelope,
            toolPack: loaded.manifest.toolPack,
            governanceProfile: loaded.manifest.governanceProfile,
          },
          safetyEnvelopeOverride: body.safetyEnvelopeOverride,
          maxConcurrentSessionsForRole: loaded.manifest.maxConcurrentSessions,
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

        // Enqueue initial invocation job
        if (app.sessionInvocationQueue) {
          await app.sessionInvocationQueue.add("invoke", {
            sessionId: session.id,
            runId: run.id,
            resumeToken: "",
            attempt: 0,
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

  // POST /api/sessions/:sessionId/runs/:runId/callback — Gateway terminal outcome (session JWT)
  app.post(
    "/:sessionId/runs/:runId/callback",
    {
      preHandler: [requireSessionToken],
      schema: {
        description:
          "Ingest terminal run outcome from OpenClaw gateway (session-scoped JWT required).",
        tags: ["Sessions"],
        params: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            runId: { type: "string" },
          },
          required: ["sessionId", "runId"],
        },
      },
    },
    async (request, reply) => {
      if (!app.sessionManager || !app.applyGatewayOutcomeForRun) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const { sessionId, runId } = request.params as { sessionId: string; runId: string };
      const claims = getSessionTokenClaims(request);

      if (claims.sessionId !== sessionId) {
        return reply.code(403).send({ error: "Token sessionId does not match path" });
      }
      const parsed = SessionRunCallbackBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid callback body", details: parsed.error.issues });
      }

      const session = await app.sessionManager.getSession(sessionId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }
      if (session.organizationId !== claims.organizationId || session.roleId !== claims.roleId) {
        return reply.code(403).send({ error: "Token does not match session principal context" });
      }

      const response = sessionCallbackBodyToGatewayResponse(parsed.data);
      try {
        await app.applyGatewayOutcomeForRun({
          sessionId,
          runId,
          response,
          logger: app.log,
        });
        app.log.info(
          {
            sessionId,
            runId,
            traceId: request.traceId,
          },
          "Session gateway callback outcome applied",
        );
      } catch (err) {
        if (
          err instanceof RunCallbackRunNotFoundError ||
          err instanceof RunCallbackSessionNotFoundError
        ) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof RunCallbackSessionMismatchError) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }

      return reply.code(200).send({ ok: true });
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
        if (app.cancelSessionWithGateway) {
          await app.cancelSessionWithGateway(id);
        } else {
          await app.sessionManager.cancelSession(id);
        }
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
