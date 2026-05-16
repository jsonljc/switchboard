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
// Auth: uses request.organizationIdFromAuth (set by authMiddleware in prod;
// set via preHandler hook from `x-org-id` header in dev/test — mirrors the
// dashboard-opportunities + lifecycle-disqualifications pattern). The hook
// populates both organizationIdFromAuth and principalIdFromAuth with a
// "default" sentinel when no header is present (so the global idempotency
// middleware fingerprint is stable across replays). The bootstrap-layer
// `resolveActor`/`resolveOrganizationId` then layer admin-specific fallbacks
// on top — "system:unknown_admin" / "system:admin-endpoint" in non-production
// mode if neither auth middleware nor the test hook populated the fields.
//
// POST routes use PlatformIngress.submit (Wave 2 Phase 1b.4 migration —
// closes Cat 1 ingress bypass 4/4). The legacy direct consentService calls
// were removed in favor of operator-mutation handlers registered in
// `bootstrap/operator-intents.ts`. The route still owns the post-mutation
// state read via `consentReader` (non-mutating, stays outside ingress).
// ---------------------------------------------------------------------------
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { PdpaJurisdictionSchema, deriveConsentStatus } from "@switchboard/schemas";
import { type ContactConsentReader, ContactNotFound } from "@switchboard/core";
import { getIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
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
  /** Resolves the actor (operator userId) from the request. */
  resolveActor: (req: import("fastify").FastifyRequest) => Promise<string>;
  /**
   * Resolves the organization context from the request auth.
   * Used to scope verdicts and handoffs to the operator's tenant.
   * Falls back to "system:admin-endpoint" when not provided (dev / legacy callers).
   */
  resolveOrganizationId?: (req: import("fastify").FastifyRequest) => Promise<string>;
}

export function registerAdminConsentRoutes(
  app: FastifyInstance,
  deps: AdminConsentRouteDeps,
): void {
  const resolveOrganizationId = async (req: import("fastify").FastifyRequest): Promise<string> => {
    if (deps.resolveOrganizationId) return deps.resolveOrganizationId(req);
    return "system:admin-endpoint";
  };

  // Dev/test mode: allow `x-org-id` header to populate request fields so the
  // global idempotency middleware fingerprint is stable across replay calls.
  // In production the auth middleware sets these before handlers run.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      const principalHeader = request.headers["x-principal-id"];
      if (typeof principalHeader === "string" && principalHeader.trim()) {
        request.principalIdFromAuth = principalHeader.trim();
      } else if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

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

  app.post("/api/admin/consent/grant", async (req, reply) => {
    const parsed = GrantBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
    }

    const actor = await deps.resolveActor(req);
    const organizationId = await resolveOrganizationId(req);
    const idempotencyKey = getIdempotencyKey(req);

    const response = await app.platformIngress.submit({
      organizationId,
      actor: { id: actor, type: "user" },
      intent: GRANT_CONSENT_INTENT,
      parameters: {
        contactId: parsed.data.contactId,
        jurisdiction: parsed.data.jurisdiction,
        source: parsed.data.source,
        grantedAt: parsed.data.grantedAt,
        notes: parsed.data.notes,
        actor,
      },
      trigger: "api",
      surface: { surface: "api" },
      ...(idempotencyKey ? { idempotencyKey } : {}),
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
  });

  app.post("/api/admin/consent/revoke", async (req, reply) => {
    const parsed = RevokeBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
    }

    const actor = await deps.resolveActor(req);
    const organizationId = await resolveOrganizationId(req);
    const idempotencyKey = getIdempotencyKey(req);

    const response = await app.platformIngress.submit({
      organizationId,
      actor: { id: actor, type: "user" },
      intent: REVOKE_CONSENT_INTENT,
      parameters: {
        contactId: parsed.data.contactId,
        source: parsed.data.source,
        revokedAt: parsed.data.revokedAt,
        notes: parsed.data.notes,
        actor,
      },
      trigger: "api",
      surface: { surface: "api" },
      ...(idempotencyKey ? { idempotencyKey } : {}),
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
  });

  app.post("/api/admin/consent/clear", async (req, reply) => {
    const parsed = ClearBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
    }

    const actor = await deps.resolveActor(req);
    const organizationId = await resolveOrganizationId(req);
    const idempotencyKey = getIdempotencyKey(req);

    const response = await app.platformIngress.submit({
      organizationId,
      actor: { id: actor, type: "user" },
      intent: CLEAR_CONSENT_INTENT,
      parameters: {
        contactId: parsed.data.contactId,
        notes: parsed.data.notes,
        actor,
      },
      trigger: "api",
      surface: { surface: "api" },
      ...(idempotencyKey ? { idempotencyKey } : {}),
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
  });

  app.get<{ Params: { contactId: string } }>(
    "/api/admin/consent/:contactId",
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
