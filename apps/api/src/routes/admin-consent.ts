import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PdpaJurisdictionSchema, deriveConsentStatus } from "@switchboard/schemas";
import {
  type ConsentService,
  type ContactConsentReader,
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
} from "@switchboard/core";

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
  consentService: ConsentService;
  consentReader: ContactConsentReader;
  /** Resolves the actor (operator userId) from the request. */
  resolveActor: (req: import("fastify").FastifyRequest) => Promise<string>;
}

export function registerAdminConsentRoutes(
  app: FastifyInstance,
  deps: AdminConsentRouteDeps,
): void {
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

    try {
      const actor = await deps.resolveActor(req);
      await deps.consentService.recordGrant({
        contactId: parsed.data.contactId,
        jurisdiction: parsed.data.jurisdiction,
        source: parsed.data.source,
        grantedAt: new Date(parsed.data.grantedAt),
        actor,
        notes: parsed.data.notes,
      });
      return reply.send(await respondWithState(parsed.data.contactId));
    } catch (err) {
      return mapError(reply, err);
    }
  });

  app.post("/api/admin/consent/revoke", async (req, reply) => {
    const parsed = RevokeBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    try {
      const actor = await deps.resolveActor(req);
      await deps.consentService.recordRevocation({
        contactId: parsed.data.contactId,
        source: "operator_recorded_revocation",
        revokedAt: new Date(parsed.data.revokedAt),
        actor,
        notes: parsed.data.notes,
      });
      return reply.send(await respondWithState(parsed.data.contactId));
    } catch (err) {
      return mapError(reply, err);
    }
  });

  app.post("/api/admin/consent/clear", async (req, reply) => {
    const parsed = ClearBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    try {
      const actor = await deps.resolveActor(req);
      await deps.consentService.clearConsent({
        contactId: parsed.data.contactId,
        actor,
        notes: parsed.data.notes,
      });
      return reply.send(await respondWithState(parsed.data.contactId));
    } catch (err) {
      return mapError(reply, err);
    }
  });

  app.get<{ Params: { contactId: string } }>(
    "/api/admin/consent/:contactId",
    async (req, reply) => {
      try {
        return reply.send(await respondWithState(req.params.contactId));
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );
}

function mapError(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof ContactNotFound) {
    return reply.status(404).send({ error: "contact_not_found", contactId: err.contactId });
  }
  if (err instanceof ConsentJurisdictionMismatch) {
    return reply.status(400).send({
      error: "jurisdiction_mismatch",
      stamped: err.stamped,
      provided: err.provided,
    });
  }
  if (err instanceof ConsentRevokedCannotRegrant) {
    return reply.status(409).send({
      error: "consent_revoked_cannot_regrant",
      hint: "POST /api/admin/consent/clear first to start a fresh cycle",
      revokedAt: err.revokedAt.toISOString(),
    });
  }
  if (err instanceof Error && (err.message.includes("notes") || err.message.includes("system:"))) {
    return reply.status(400).send({ error: "invalid_actor_or_notes", message: err.message });
  }
  reply.log.error({ err }, "admin-consent unexpected error");
  return reply.status(500).send({ error: "internal_error" });
}
