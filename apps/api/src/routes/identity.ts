import type { FastifyPluginAsync } from "fastify";
import type { IdentitySpec, RoleOverlay } from "@switchboard/schemas";
import {
  CreateIdentitySpecBodySchema,
  UpdateIdentitySpecBodySchema,
  CreateRoleOverlayBodySchema,
  UpdateRoleOverlayBodySchema,
} from "../validation.js";

export const identityRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/identity/specs
  app.post("/specs", async (request, reply) => {
    const parsed = CreateIdentitySpecBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const now = new Date();
    const spec: IdentitySpec = {
      id: `spec_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      ...parsed.data,
    };

    await app.storageContext.identity.saveSpec(spec);
    return reply.code(201).send({ spec });
  });

  // GET /api/identity/specs/:id
  app.get("/specs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const spec = await app.storageContext.identity.getSpecById(id);
    if (!spec) {
      return reply.code(404).send({ error: "Identity spec not found" });
    }
    return reply.code(200).send({ spec });
  });

  // GET /api/identity/specs/by-principal/:principalId
  app.get("/specs/by-principal/:principalId", async (request, reply) => {
    const { principalId } = request.params as { principalId: string };
    const spec = await app.storageContext.identity.getSpecByPrincipalId(principalId);
    if (!spec) {
      return reply.code(404).send({ error: "Identity spec not found" });
    }
    return reply.code(200).send({ spec });
  });

  // PUT /api/identity/specs/:id
  app.put("/specs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsed = UpdateIdentitySpecBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const existing = await app.storageContext.identity.getSpecById(id);
    if (!existing) {
      return reply.code(404).send({ error: "Identity spec not found" });
    }

    const updated: IdentitySpec = {
      ...existing,
      ...parsed.data,
      id, // cannot change ID
      updatedAt: new Date(),
    };
    await app.storageContext.identity.saveSpec(updated);
    return reply.code(200).send({ spec: updated });
  });

  // POST /api/identity/overlays
  app.post("/overlays", async (request, reply) => {
    const parsed = CreateRoleOverlayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const now = new Date();
    const overlay: RoleOverlay = {
      id: `overlay_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      ...parsed.data,
    };

    await app.storageContext.identity.saveOverlay(overlay);
    return reply.code(201).send({ overlay });
  });

  // GET /api/identity/overlays - List overlays by spec ID
  app.get("/overlays", async (request, reply) => {
    const query = request.query as { specId?: string };
    if (!query.specId) {
      return reply.code(400).send({ error: "specId query parameter required" });
    }
    const overlays = await app.storageContext.identity.listOverlaysBySpecId(query.specId);
    return reply.code(200).send({ overlays });
  });

  // PUT /api/identity/overlays/:id
  app.put("/overlays/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsed = UpdateRoleOverlayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

    const overlay: RoleOverlay = {
      id,
      identitySpecId: body.identitySpecId ?? "",
      name: body.name ?? "",
      description: body.description ?? "",
      mode: body.mode ?? "restrict",
      priority: body.priority ?? 0,
      active: body.active ?? true,
      conditions: body.conditions ?? {},
      overrides: body.overrides ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await app.storageContext.identity.saveOverlay(overlay);
    return reply.code(200).send({ overlay });
  });
};
