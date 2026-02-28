import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";

export const connectionsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/connections — create a new connection (org-scoped)
  app.post("/", {
    schema: {
      description: "Create a new service connection with encrypted credentials.",
      tags: ["Connections"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const body = request.body as {
      serviceId: string;
      serviceName: string;
      authType: string;
      credentials: Record<string, unknown>;
      scopes?: string[];
    };

    if (!body.serviceId || !body.serviceName || !body.authType || !body.credentials) {
      return reply.code(400).send({ error: "serviceId, serviceName, authType, and credentials are required", statusCode: 400 });
    }

    const organizationId = request.organizationIdFromAuth ?? null;
    const { PrismaConnectionStore } = await import("@switchboard/db");
    const store = new PrismaConnectionStore(app.prisma);

    const connection = {
      id: randomUUID(),
      serviceId: body.serviceId,
      serviceName: body.serviceName,
      organizationId,
      authType: body.authType,
      credentials: body.credentials,
      scopes: body.scopes ?? [],
      refreshStrategy: "auto",
      status: "connected",
      lastHealthCheck: null,
    };

    await store.save(connection);
    return reply.code(201).send({
      connection: { ...connection, credentials: "***" },
    });
  });

  // GET /api/connections — list connections (org-scoped, creds redacted)
  app.get("/", {
    schema: {
      description: "List all connections for the authenticated organization.",
      tags: ["Connections"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const organizationId = request.organizationIdFromAuth;
    const { PrismaConnectionStore } = await import("@switchboard/db");
    const store = new PrismaConnectionStore(app.prisma);
    const connections = await store.list(organizationId);

    return reply.code(200).send({
      connections: connections.map((c) => ({ ...c, credentials: "***" })),
    });
  });

  // GET /api/connections/:id — get one connection (creds redacted)
  app.get("/:id", {
    schema: {
      description: "Get a single connection by ID.",
      tags: ["Connections"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { id } = request.params as { id: string };
    const { PrismaConnectionStore } = await import("@switchboard/db");
    const store = new PrismaConnectionStore(app.prisma);
    const connection = await store.getById(id);

    if (!connection) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    // Scope check
    if (request.organizationIdFromAuth && connection.organizationId !== request.organizationIdFromAuth) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    return reply.code(200).send({ connection: { ...connection, credentials: "***" } });
  });

  // PUT /api/connections/:id — update connection via save() (upsert)
  app.put("/:id", {
    schema: {
      description: "Update an existing connection.",
      tags: ["Connections"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      serviceName?: string;
      authType?: string;
      credentials?: Record<string, unknown>;
      scopes?: string[];
    };

    const { PrismaConnectionStore } = await import("@switchboard/db");
    const store = new PrismaConnectionStore(app.prisma);
    const existing = await store.getById(id);

    if (!existing) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    if (request.organizationIdFromAuth && existing.organizationId !== request.organizationIdFromAuth) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    await store.save({
      ...existing,
      serviceName: body.serviceName ?? existing.serviceName,
      authType: body.authType ?? existing.authType,
      credentials: body.credentials ?? existing.credentials,
      scopes: body.scopes ?? existing.scopes,
    });

    return reply.code(200).send({ connection: { id, updated: true } });
  });

  // DELETE /api/connections/:id — remove connection
  app.delete("/:id", {
    schema: {
      description: "Delete a connection by ID.",
      tags: ["Connections"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { id } = request.params as { id: string };
    const { PrismaConnectionStore } = await import("@switchboard/db");
    const store = new PrismaConnectionStore(app.prisma);
    const existing = await store.getById(id);

    if (!existing) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    if (request.organizationIdFromAuth && existing.organizationId !== request.organizationIdFromAuth) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    await store.delete(id);
    return reply.code(200).send({ id, deleted: true });
  });

  // POST /api/connections/:id/test — test connection health
  app.post("/:id/test", {
    schema: {
      description: "Test a connection by running the cartridge healthCheck.",
      tags: ["Connections"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { id } = request.params as { id: string };
    const { PrismaConnectionStore } = await import("@switchboard/db");
    const store = new PrismaConnectionStore(app.prisma);
    const connection = await store.getById(id);

    if (!connection) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    if (request.organizationIdFromAuth && connection.organizationId !== request.organizationIdFromAuth) {
      return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
    }

    // Try to find the cartridge that uses this service
    const cartridgeIds = app.storageContext.cartridges.list();
    let healthResult: { healthy: boolean; detail?: string } = { healthy: false, detail: "No matching cartridge found" };

    for (const cId of cartridgeIds) {
      const cartridge = app.storageContext.cartridges.get(cId);
      if (!cartridge) continue;
      const manifest = cartridge.manifest;
      const required = manifest.requiredConnections ?? [];
      if (required.some((rc: string) => rc === connection.serviceId)) {
        // Found a matching cartridge — check if it has healthCheck
        if (typeof (cartridge as any).healthCheck === "function") {
          try {
            await (cartridge as any).healthCheck();
            healthResult = { healthy: true };
          } catch (err: any) {
            healthResult = { healthy: false, detail: err.message };
          }
        } else {
          healthResult = { healthy: true, detail: "No healthCheck method, assuming OK" };
        }
        break;
      }
    }

    await store.updateStatus(id, healthResult.healthy ? "connected" : "error");

    return reply.code(200).send(healthResult);
  });
};
