// @route-class: control-plane
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Policy } from "@switchboard/schemas";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CreatePolicyBodySchema, UpdatePolicyBodySchema } from "../validation.js";
import { assertOrgAccess } from "../utils/org-access.js";
import { requireRole } from "../utils/require-role.js";
import { extractActionTypeMatchers } from "../utils/policy-rule-matchers.js";

const createPolicyJsonSchema = zodToJsonSchema(CreatePolicyBodySchema, { target: "openApi3" });
const updatePolicyJsonSchema = zodToJsonSchema(UpdatePolicyBodySchema, { target: "openApi3" });

export const policiesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/policies
  app.get(
    "/",
    {
      schema: {
        description: "List all active policies. Optionally filter by cartridgeId.",
        tags: ["Policies"],
        querystring: { type: "object", properties: { cartridgeId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const query = request.query as { cartridgeId?: string };
      const orgId = request.organizationIdFromAuth ?? undefined;
      const filter: { cartridgeId?: string; organizationId?: string | null } = {};
      if (query.cartridgeId) filter.cartridgeId = query.cartridgeId;
      if (orgId !== undefined) filter.organizationId = orgId;
      const policies = await app.storageContext.policies.listActive(
        Object.keys(filter).length > 0 ? filter : undefined,
      );
      return reply.code(200).send({ policies });
    },
  );

  // POST /api/policies
  app.post(
    "/",
    {
      schema: {
        description: "Create a new guardrail policy.",
        tags: ["Policies"],
        body: createPolicyJsonSchema,
      },
    },
    async (request, reply) => {
      if (!(await requireRole(request, reply, "admin", "operator"))) return;

      const parsed = CreatePolicyBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }

      const now = new Date();
      const policy: Policy = {
        id: `policy_${randomUUID()}`,
        createdAt: now,
        updatedAt: now,
        ...parsed.data,
      };

      await app.storageContext.policies.save(policy);
      await app.policyCache.invalidate(policy.cartridgeId ?? undefined);

      // Audit: record policy creation
      await app.auditLedger.record({
        eventType: "policy.created",
        actorType: "user",
        actorId: request.principalIdFromAuth ?? "unknown",
        entityType: "policy",
        entityId: policy.id,
        riskCategory: "low",
        summary: `Policy "${policy.name}" created`,
        snapshot: { policy },
        organizationId: request.organizationIdFromAuth ?? undefined,
      });

      return reply.code(201).send({ policy });
    },
  );

  // GET /api/policies/:id
  app.get(
    "/:id",
    {
      schema: {
        description: "Get a policy by ID.",
        tags: ["Policies"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const policy = await app.storageContext.policies.getById(id);
      if (!policy) {
        return reply.code(404).send({ error: "Policy not found", statusCode: 404 });
      }
      if (!assertOrgAccess(request, policy.organizationId, reply)) return;
      return reply.code(200).send({ policy });
    },
  );

  // PUT /api/policies/:id
  app.put(
    "/:id",
    {
      schema: {
        description: "Update an existing policy.",
        tags: ["Policies"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: updatePolicyJsonSchema,
      },
    },
    async (request, reply) => {
      if (!(await requireRole(request, reply, "admin", "operator"))) return;

      const { id } = request.params as { id: string };

      const parsed = UpdatePolicyBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }

      const existing = await app.storageContext.policies.getById(id);
      if (!existing) {
        return reply.code(404).send({ error: "Policy not found", statusCode: 404 });
      }
      if (!assertOrgAccess(request, existing.organizationId, reply)) return;

      await app.storageContext.policies.update(
        id,
        {
          ...parsed.data,
          updatedAt: new Date(),
        },
        existing.organizationId,
      );
      await app.policyCache.invalidate(existing.cartridgeId ?? undefined);
      const updated = await app.storageContext.policies.getById(id);

      // Audit: record policy update with previous values
      await app.auditLedger.record({
        eventType: "policy.updated",
        actorType: "user",
        actorId: request.principalIdFromAuth ?? "unknown",
        entityType: "policy",
        entityId: id,
        riskCategory: "low",
        summary: `Policy "${existing.name}" updated`,
        snapshot: { previous: existing, current: updated },
        organizationId: request.organizationIdFromAuth ?? undefined,
      });

      return reply.code(200).send({ policy: updated });
    },
  );

  // DELETE /api/policies/:id
  app.delete(
    "/:id",
    {
      schema: {
        description: "Delete a policy by ID.",
        tags: ["Policies"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      if (!(await requireRole(request, reply, "admin", "operator"))) return;

      const { id } = request.params as { id: string };
      const existing = await app.storageContext.policies.getById(id);
      if (!existing) {
        return reply.code(404).send({ error: "Policy not found", statusCode: 404 });
      }
      if (!assertOrgAccess(request, existing.organizationId, reply)) return;

      // D5-2b: refuse to orphan an allow policy. Deleting a require_approval policy
      // while a matching allow policy for the SAME actionType survives leaves
      // "allow alone" - which EXECUTES the governed action with no human
      // (riley-pause-gate.test.ts:164 pins this decomposition). Scope the sibling
      // search to the deleted policy's OWN org (existing.organizationId), not the
      // caller's auth org: a global super-admin deleting an org-scoped approval row
      // must still see that org's allow sibling.
      if (existing.effect === "require_approval") {
        const guardedActionTypes = extractActionTypeMatchers(existing.rule);
        if (guardedActionTypes.length > 0) {
          const siblings = await app.storageContext.policies.listActive({
            organizationId: existing.organizationId,
          });
          const orphanedAllow = siblings.some(
            (p) =>
              p.id !== existing.id &&
              p.effect === "allow" &&
              extractActionTypeMatchers(p.rule).some((v) => guardedActionTypes.includes(v)),
          );
          if (orphanedAllow) {
            return reply.code(409).send({
              error:
                "Refusing to delete: this require_approval policy guards an action whose allow " +
                "policy would survive, leaving the action ungated (allow alone self-executes). " +
                "Delete the matching allow policy first, or both together.",
              statusCode: 409,
            });
          }
        }
      }

      const deleted = await app.storageContext.policies.delete(id, existing.organizationId);
      if (!deleted) {
        return reply.code(404).send({ error: "Policy not found", statusCode: 404 });
      }
      if (existing) {
        await app.policyCache.invalidate(existing.cartridgeId ?? undefined);

        // Audit: record policy deletion
        await app.auditLedger.record({
          eventType: "policy.deleted",
          actorType: "user",
          actorId: request.principalIdFromAuth ?? "unknown",
          entityType: "policy",
          entityId: id,
          riskCategory: "medium",
          summary: `Policy "${existing.name}" deleted`,
          snapshot: { deletedPolicy: existing },
          organizationId: request.organizationIdFromAuth ?? undefined,
        });
      }
      return reply.code(200).send({ id, deleted: true });
    },
  );
};
