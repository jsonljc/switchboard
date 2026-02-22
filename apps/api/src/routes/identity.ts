import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { IdentitySpec, RoleOverlay } from "@switchboard/schemas";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CreateIdentitySpecBodySchema,
  UpdateIdentitySpecBodySchema,
  CreateRoleOverlayBodySchema,
  UpdateRoleOverlayBodySchema,
} from "../validation.js";

const createSpecJsonSchema = zodToJsonSchema(CreateIdentitySpecBodySchema, { target: "openApi3" });
const updateSpecJsonSchema = zodToJsonSchema(UpdateIdentitySpecBodySchema, { target: "openApi3" });
const createOverlayJsonSchema = zodToJsonSchema(CreateRoleOverlayBodySchema, { target: "openApi3" });
const updateOverlayJsonSchema = zodToJsonSchema(UpdateRoleOverlayBodySchema, { target: "openApi3" });

export const identityRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/identity/specs
  app.post("/specs", {
    schema: {
      description: "Create a new identity spec.",
      tags: ["Identity"],
      body: createSpecJsonSchema,
    },
  }, async (request, reply) => {
    const parsed = CreateIdentitySpecBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const now = new Date();
    const spec: IdentitySpec = {
      id: `spec_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      ...parsed.data,
    };

    await app.storageContext.identity.saveSpec(spec);
    return reply.code(201).send({ spec });
  });

  // GET /api/identity/specs/:id
  app.get("/specs/:id", {
    schema: {
      description: "Get an identity spec by ID.",
      tags: ["Identity"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const spec = await app.storageContext.identity.getSpecById(id);
    if (!spec) {
      return reply.code(404).send({ error: "Identity spec not found" });
    }
    return reply.code(200).send({ spec });
  });

  // GET /api/identity/specs/by-principal/:principalId
  app.get("/specs/by-principal/:principalId", {
    schema: {
      description: "Look up an identity spec by principal ID.",
      tags: ["Identity"],
      params: { type: "object", properties: { principalId: { type: "string" } }, required: ["principalId"] },
    },
  }, async (request, reply) => {
    const { principalId } = request.params as { principalId: string };
    const spec = await app.storageContext.identity.getSpecByPrincipalId(principalId);
    if (!spec) {
      return reply.code(404).send({ error: "Identity spec not found" });
    }
    return reply.code(200).send({ spec });
  });

  // PUT /api/identity/specs/:id
  app.put("/specs/:id", {
    schema: {
      description: "Update an existing identity spec.",
      tags: ["Identity"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: updateSpecJsonSchema,
    },
  }, async (request, reply) => {
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
  app.post("/overlays", {
    schema: {
      description: "Create a new role overlay for an identity spec.",
      tags: ["Identity"],
      body: createOverlayJsonSchema,
    },
  }, async (request, reply) => {
    const parsed = CreateRoleOverlayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const now = new Date();
    const overlay: RoleOverlay = {
      id: `overlay_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      ...parsed.data,
    };

    await app.storageContext.identity.saveOverlay(overlay);
    return reply.code(201).send({ overlay });
  });

  // GET /api/identity/overlays - List overlays by spec ID
  app.get("/overlays", {
    schema: {
      description: "List role overlays for a given identity spec.",
      tags: ["Identity"],
      querystring: { type: "object", properties: { specId: { type: "string" } }, required: ["specId"] },
    },
  }, async (request, reply) => {
    const query = request.query as { specId?: string };
    if (!query.specId) {
      return reply.code(400).send({ error: "specId query parameter required" });
    }
    const overlays = await app.storageContext.identity.listOverlaysBySpecId(query.specId);
    return reply.code(200).send({ overlays });
  });

  // PUT /api/identity/overlays/:id
  app.put("/overlays/:id", {
    schema: {
      description: "Update an existing role overlay.",
      tags: ["Identity"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: updateOverlayJsonSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsed = UpdateRoleOverlayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const existing = await app.storageContext.identity.getOverlayById(id);
    if (!existing) {
      return reply.code(404).send({ error: "Role overlay not found" });
    }

    const overlay: RoleOverlay = {
      ...existing,
      ...parsed.data,
      id,
      updatedAt: new Date(),
    };

    await app.storageContext.identity.saveOverlay(overlay);
    return reply.code(200).send({ overlay });
  });
};
