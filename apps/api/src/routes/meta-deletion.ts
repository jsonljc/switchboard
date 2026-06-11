// @route-class: ingress-receiver
// Meta Data Deletion Callback endpoint.
//
// Required for Meta App Review submission: when a user requests their data
// be deleted via Meta, Meta POSTs a `signed_request` here. We verify it,
// look up any Contact rows whose phone matches the app-scoped user_id,
// run the cascade delete, and return `{ url, confirmation_code }` per
// Meta's spec. The URL points at the public status endpoint so the user
// can verify the deletion ran.
//
// No API-key auth — the request comes from Meta. Auth bypass is registered
// in middleware/auth.ts; integrity is enforced by HMAC verification of the
// signed_request against META_APP_SECRET.

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { PrismaContactStore, type PrismaClient } from "@switchboard/db";
import { parseAndVerifySignedRequest } from "../lib/meta-signed-request.js";
import { eraseContactFully } from "../lib/erase-contact.js";
import {
  createCalendarProviderFactory,
  type CalendarProviderFactory,
} from "../bootstrap/calendar-provider-factory.js";

interface DeletionRequestBody {
  signed_request?: string;
}

interface MetaDeletionDeps {
  /** Override for tests; defaults to process.env.META_APP_SECRET. */
  appSecret?: string;
  /** Override for tests; defaults to the real env-backed calendar factory built
   *  from app.prisma. Used to cancel external calendar events during erasure. */
  calendarProviderFactory?: CalendarProviderFactory;
}

export const metaDeletionRoutes: FastifyPluginAsync<MetaDeletionDeps> = async (app, deps) => {
  // Resolve the calendar provider factory used to cancel a patient's external
  // calendar events during erasure (F5). Built per request (rare endpoint; the
  // factory caches per-org internally) rather than reusing the app-wide skill
  // runtime factory, which is not decorated on `app`. Injectable for tests.
  const resolveCalendarFactory = (
    request: FastifyRequest,
    prismaClient: PrismaClient,
  ): CalendarProviderFactory =>
    deps.calendarProviderFactory ??
    createCalendarProviderFactory({
      prismaClient,
      logger: {
        info: (m: string) => request.log.info(m),
        error: (m: string) => request.log.error(m),
      },
    });

  // POST /api/meta/deletion — Meta data deletion callback
  app.post(
    "/",
    {
      // Public endpoint (HMAC-verified, no API key) — must be rate-limited to
      // prevent abuse of the HMAC verification path. Meta's deletion volume is
      // tiny in practice; 10/min per IP is generous.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        description:
          "Meta App Data Deletion callback. Verifies signed_request and deletes contact PII.",
        tags: ["Meta"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const appSecret = deps.appSecret ?? process.env["META_APP_SECRET"] ?? "";
      const body = request.body as DeletionRequestBody | undefined;
      const signedRequest = body?.signed_request;

      if (typeof signedRequest !== "string" || signedRequest.length === 0) {
        return reply.code(400).send({ error: "Missing signed_request parameter", statusCode: 400 });
      }

      const verified = parseAndVerifySignedRequest(signedRequest, appSecret);
      if (!verified.ok) {
        request.log.warn({ reason: verified.reason }, "Meta deletion: signed_request rejected");
        return reply.code(400).send({ error: "Invalid signed_request", statusCode: 400 });
      }

      const userId = verified.payload.user_id;
      const confirmationCode = randomUUID();

      // Phone match: Meta's app-scoped user_id for WhatsApp is typically the
      // wa-id (digits only). Our Contact.phone column is canonically stored
      // with a leading "+". Match both shapes to be safe.
      const candidateValues = userId.startsWith("+")
        ? [userId, userId.slice(1)]
        : [userId, `+${userId}`];

      const contactStore = new PrismaContactStore(app.prisma);
      const calendarProviderFactory = resolveCalendarFactory(request, app.prisma);
      const deletedIds: string[] = [];
      let failureReason: string | null = null;

      try {
        const matches = await app.prisma.contact.findMany({
          where: { phone: { in: candidateValues } },
          select: { id: true, organizationId: true },
        });

        for (const match of matches) {
          await eraseContactFully(
            { prisma: app.prisma, contactStore, calendarProviderFactory, logger: request.log },
            match.organizationId,
            match.id,
          );
          deletedIds.push(match.id);
        }
      } catch (err) {
        request.log.error({ err, userId }, "Meta deletion: cascade delete failed");
        failureReason = err instanceof Error ? err.message : "unknown_error";
      }

      const status = failureReason === null ? "completed" : "failed";
      const completedAt = failureReason === null ? new Date() : null;

      // Persist the request record. If this insert itself fails we still
      // owe Meta a response — log and proceed; ops can reconcile via logs.
      try {
        await app.prisma.dataDeletionRequest.create({
          data: {
            userId,
            confirmationCode,
            deletedContactIds: deletedIds,
            status,
            failureReason,
            completedAt,
          },
        });
      } catch (err) {
        request.log.error(
          { err, userId, confirmationCode },
          "Meta deletion: failed to persist request record",
        );
      }

      const proto =
        (request.headers["x-forwarded-proto"] as string | undefined) ?? request.protocol;
      const host =
        (request.headers["x-forwarded-host"] as string | undefined) ?? request.headers.host;
      const url = `${proto}://${host}/api/meta/deletion/status?code=${confirmationCode}`;

      return reply.code(200).send({ url, confirmation_code: confirmationCode });
    },
  );

  // GET /api/meta/deletion/status?code=... — public status check for users
  app.get(
    "/status",
    {
      schema: {
        description: "Public status check for a Meta data deletion request.",
        tags: ["Meta"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const code = (request.query as { code?: string } | undefined)?.code;
      if (typeof code !== "string" || code.length === 0) {
        return reply.code(400).send({ error: "Missing code parameter", statusCode: 400 });
      }

      const record = await app.prisma.dataDeletionRequest.findUnique({
        where: { confirmationCode: code },
        select: {
          status: true,
          completedAt: true,
          createdAt: true,
          deletedContactIds: true,
        },
      });

      if (!record) {
        return reply.code(404).send({ error: "Deletion request not found", statusCode: 404 });
      }

      return reply.code(200).send({
        status: record.status,
        completed_at: record.completedAt?.toISOString() ?? null,
        requested_at: record.createdAt.toISOString(),
        deleted_record_count: record.deletedContactIds.length,
      });
    },
  );
};
