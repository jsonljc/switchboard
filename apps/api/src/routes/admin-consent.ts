// @route-class: operator-direct
// Note: this file mixes one read-only GET + 3 operator-direct POSTs. The
// class label reflects the dominant mutation semantics; the GET handler
// pre-dates the contract and is exempted by file-level classification.
//
// apps/api/src/routes/admin-consent.ts
// ---------------------------------------------------------------------------
// Phase 1c — admin consent endpoint
//
// Endpoints:
//   POST /api/admin/consent/grant
//   POST /api/admin/consent/revoke
//   POST /api/admin/consent/clear
//   GET  /api/admin/consent/:contactId
//
// Auth: `buildDevAuthFallback` populates org/principal in dev/test mode;
// production auth middleware does it for real. The `requireOrg` /
// `requireOrgForMutation` decorators narrow `request.orgId` + `request.actorId`
// and fail-closed with 403 when no org is bound (Route Governance Contract v1).
//
// POST routes use PlatformIngress.submit (Wave 2 Phase 1b.4 migration —
// closes Cat 1 ingress bypass 4/4) and mandate `Idempotency-Key` via
// `requireIdempotencyKey` (Contract §7.1). The legacy direct consentService
// calls were removed in favor of operator-mutation handlers registered in
// `bootstrap/operator-intents.ts`. The route still owns the post-mutation
// state read via `consentReader` (non-mutating, stays outside ingress).
// ---------------------------------------------------------------------------
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { PdpaJurisdictionSchema, deriveConsentStatus } from "@switchboard/schemas";
import { type ContactConsentReader, ContactNotFound } from "@switchboard/core";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { replyValidationError } from "../utils/validation-error.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrg, requireOrgForMutation } from "../decorators/org.js";
import {
  CLEAR_CONSENT_INTENT,
  GRANT_CONSENT_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
  REVOKE_CONSENT_INTENT,
} from "../bootstrap/operator-intents.js";

const GrantBody = z.object({
  contactId: z.string().min(1),
  jurisdiction: PdpaJurisdictionSchema,
  source: z.enum(["whatsapp_quick_reply", "ig_dm_reply", "web_form", "operator_recorded"]),
  grantedAt: z.string().datetime(),
  notes: z.string().optional(),
});

const RevokeBody = z.object({
  contactId: z.string().min(1),
  source: z.literal("operator_recorded_revocation"),
  revokedAt: z.string().datetime(),
  notes: z.string().optional(),
});

const ClearBody = z.object({
  contactId: z.string().min(1),
  notes: z.string().min(1, "notes are required for audit trail"),
});

export interface AdminConsentRouteDeps {
  consentReader: ContactConsentReader;
}

export function registerAdminConsentRoutes(
  app: FastifyInstance,
  deps: AdminConsentRouteDeps,
): void {
  // Dev/test mode (authDisabled): populate organizationIdFromAuth + principalIdFromAuth
  // from x-org-id / x-principal-id headers (or fall back to "default"). In production
  // this hook is a no-op; the real auth middleware has already populated the fields.
  app.addHook("preHandler", buildDevAuthFallback(app));

  const respondWithState = async (contactId: string) => {
    const state = await deps.consentReader.read(contactId);
    return {
      ...state,
      status: deriveConsentStatus({
        pdpaJurisdiction: state.pdpaJurisdiction,
        consentGrantedAt: state.consentGrantedAt,
        consentRevokedAt: state.consentRevokedAt,
      }),
    };
  };

  app.post(
    "/api/admin/consent/grant",
    { preHandler: requireOrgForMutation },
    async (req, reply) => {
      const parsed = GrantBody.safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, parsed.error);

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(req, reply);
      if (!idempotencyKey) return;

      const { orgId, actorId } = req;

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: GRANT_CONSENT_INTENT,
        parameters: {
          contactId: parsed.data.contactId,
          jurisdiction: parsed.data.jurisdiction,
          source: parsed.data.source,
          grantedAt: parsed.data.grantedAt,
          notes: parsed.data.notes,
          actor: actorId,
        },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        return mapFailedOutcome(reply, result.error?.code, result.outputs, result.error?.message);
      }

      try {
        return reply.send(await respondWithState(parsed.data.contactId));
      } catch (err) {
        return mapReaderError(reply, err);
      }
    },
  );

  app.post(
    "/api/admin/consent/revoke",
    { preHandler: requireOrgForMutation },
    async (req, reply) => {
      const parsed = RevokeBody.safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, parsed.error);

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(req, reply);
      if (!idempotencyKey) return;

      const { orgId, actorId } = req;

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: REVOKE_CONSENT_INTENT,
        parameters: {
          contactId: parsed.data.contactId,
          source: parsed.data.source,
          revokedAt: parsed.data.revokedAt,
          notes: parsed.data.notes,
          actor: actorId,
        },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        return mapFailedOutcome(reply, result.error?.code, result.outputs, result.error?.message);
      }

      try {
        return reply.send(await respondWithState(parsed.data.contactId));
      } catch (err) {
        return mapReaderError(reply, err);
      }
    },
  );

  app.post(
    "/api/admin/consent/clear",
    { preHandler: requireOrgForMutation },
    async (req, reply) => {
      const parsed = ClearBody.safeParse(req.body);
      if (!parsed.success) return replyValidationError(reply, parsed.error);

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(req, reply);
      if (!idempotencyKey) return;

      const { orgId, actorId } = req;

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: CLEAR_CONSENT_INTENT,
        parameters: {
          contactId: parsed.data.contactId,
          notes: parsed.data.notes,
          actor: actorId,
        },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        return mapFailedOutcome(reply, result.error?.code, result.outputs, result.error?.message);
      }

      try {
        return reply.send(await respondWithState(parsed.data.contactId));
      } catch (err) {
        return mapReaderError(reply, err);
      }
    },
  );

  app.get<{ Params: { contactId: string } }>(
    "/api/admin/consent/:contactId",
    { preHandler: requireOrg },
    async (req, reply) => {
      try {
        return reply.send(await respondWithState(req.params.contactId));
      } catch (err) {
        return mapReaderError(reply, err);
      }
    },
  );
}

/**
 * Map a typed `outcome: "failed"` handler result onto the existing
 * admin-consent response envelope. Each code preserves the structured payload
 * (stamped/provided, revokedAt, etc.) that the old `mapError` helper returned
 * pre-ingress.
 */
function mapFailedOutcome(
  reply: FastifyReply,
  code: string | undefined,
  outputs: Record<string, unknown> | undefined,
  message: string | undefined,
): FastifyReply {
  const o = outputs ?? {};
  if (code === OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND) {
    return reply.status(404).send({ error: "contact_not_found", contactId: o["contactId"] });
  }
  if (code === OPERATOR_INTENT_ERROR_CODES.CONSENT_INVALID_JURISDICTION) {
    return reply.status(400).send({
      error: "jurisdiction_mismatch",
      stamped: o["stamped"],
      provided: o["provided"],
    });
  }
  if (code === OPERATOR_INTENT_ERROR_CODES.CONSENT_REVOKED_CANNOT_REGRANT) {
    return reply.status(409).send({
      error: "consent_revoked_cannot_regrant",
      hint: "POST /api/admin/consent/clear first to start a fresh cycle",
      revokedAt: o["revokedAt"],
    });
  }
  if (code === OPERATOR_INTENT_ERROR_CODES.CONSENT_OPERATION_FAILED) {
    // Phase 1b.4 review-followup: stable client-facing envelope; do NOT echo
    // the service-thrown message (which contains internal validation text like
    // "rejects system: actors"). The `code` is sufficient for client logic.
    return reply.status(400).send({ error: "invalid_actor_or_notes" });
  }
  // Unexpected handler-level failure — scrubbed 500 (don't leak codes/messages).
  reply.log.error({ code, message }, "admin-consent unexpected handler failure");
  return reply.status(500).send({ error: "internal_error" });
}

function mapReaderError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ContactNotFound) {
    return reply.status(404).send({ error: "contact_not_found", contactId: err.contactId });
  }
  reply.log.error({ err }, "admin-consent unexpected reader error");
  return reply.status(500).send({ error: "internal_error" });
}
