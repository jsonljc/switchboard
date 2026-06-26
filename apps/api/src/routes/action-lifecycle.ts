// @route-class: lifecycle
//
// Lifecycle transitions on an already-addressed work unit — NOT operator-direct
// ingress. POST /:id/execute and POST /:id/undo operate on a work unit that has
// already been created and addressed by id; they are state transitions on that
// unit, not new mutating ingress submissions. They therefore do not carry the
// operator-direct idempotency contract (a fresh Idempotency-Key per call would
// lie about the operation — the id IS the dedup boundary). Deliberate route-class
// split per #654; this is an intentional classification, not a validator bypass.
import type { FastifyPluginAsync } from "fastify";
import { APPROVER_ROLES } from "@switchboard/core";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";
import { requireRole } from "../utils/require-role.js";

export const actionLifecycleRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/actions/:id/execute - Execute a previously approved work unit
  app.post(
    "/:id/execute",
    {
      schema: {
        description: "Execute a previously approved work unit.",
        tags: ["Actions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Approver-role floor (A16): executing a previously approved work unit is a
      // privileged dispatch; only approver/operator/admin may trigger it. Dev mode
      // (authDisabled) bypasses, matching assertOrgAccess. Runs before the org gate.
      if (!(await requireRole(request, reply, ...APPROVER_ROLES))) return;

      // Tenant isolation: verify the caller's org owns this work unit before
      // executing. executeApproved runs off a WorkTrace when no legacy envelope
      // exists (the platform-native path), so the trace org must be gated too —
      // not just the envelope. Prefer the trace (matching executeAfterApproval's
      // own resolution order), fall back to the legacy envelope. Only when
      // NEITHER exists do we fall through to executeApproved, which owns the
      // not-found / non-approved 400 (lifecycle route-class contract, #654).
      // Mirrors the org guard already on POST /:id/undo.
      const traceResult = await app.workTraceStore?.getByWorkUnitId(id);
      if (traceResult) {
        if (!assertOrgAccess(request, traceResult.trace.organizationId, reply)) return;
      } else {
        const envelope = await app.storageContext.envelopes.getById(id);
        if (envelope) {
          const envelopeOrgId = envelope.proposals[0]?.parameters["_organizationId"] as
            | string
            | null
            | undefined;
          if (!assertOrgAccess(request, envelopeOrgId, reply)) return;
        }
      }

      try {
        // Compatibility shim: direct execute goes through legacy PlatformLifecycle.
        // When lifecycle service is fully wired, this route must go through
        // lifecycle dispatch admission (prepareDispatch + validateDispatchAdmission).
        const result = await app.platformLifecycle.executeApproved(id);
        return reply.code(200).send({ result });
      } catch (err) {
        return reply.code(400).send({
          error: sanitizeErrorMessage(err, 400),
          statusCode: 400,
        });
      }
    },
  );

  // POST /api/actions/:id/undo - Request undo for an executed action
  app.post(
    "/:id/undo",
    {
      schema: {
        description:
          "Request undo for a previously executed action. Creates a new reverse proposal.",
        tags: ["Actions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const envelope = await app.storageContext.envelopes.getById(id);
      if (!envelope) {
        return reply.code(404).send({ error: "Envelope not found", statusCode: 404 });
      }

      const envelopeOrgId = envelope.proposals[0]?.parameters["_organizationId"] as
        | string
        | null
        | undefined;
      if (!assertOrgAccess(request, envelopeOrgId, reply)) return;

      try {
        const result = await app.platformLifecycle.requestUndo(id, app.platformIngress);
        if (!result.undoSubmitted) {
          // The reverse action did not complete. Surface undoWorkUnitId when present
          // (e.g. undo_parked_for_approval: a reverse work unit DOES exist, pending
          // approval) so the operator has a handle to track it rather than a bare 400.
          return reply.code(400).send({
            error: result.error ?? "Undo submission failed",
            ...(result.undoWorkUnitId ? { undoWorkUnitId: result.undoWorkUnitId } : {}),
            statusCode: 400,
          });
        }
        return reply.code(201).send({
          undoSubmitted: true,
          undoWorkUnitId: result.undoWorkUnitId,
        });
      } catch (err) {
        return reply.code(400).send({
          error: sanitizeErrorMessage(err, 400),
          statusCode: 400,
        });
      }
    },
  );
};
