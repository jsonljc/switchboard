import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { getConnectionStore } from "../utils/connection-store.js";
import { CreateConnectionBodySchema, UpdateConnectionBodySchema } from "../validation.js";

function redactCredentials<T extends { credentials: unknown }>(
  connection: T,
): Omit<T, "credentials"> & { credentials: string } {
  const { credentials: _, ...rest } = connection;
  return { ...rest, credentials: "***" } as Omit<T, "credentials"> & { credentials: string };
}

function hasEncryptionKey(): boolean {
  return !!process.env["CREDENTIALS_ENCRYPTION_KEY"];
}

export const connectionsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/connections — create a new connection (org-scoped)
  app.post(
    "/",
    {
      schema: {
        description: "Create a new service connection with encrypted credentials.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const parsed = CreateConnectionBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join("; "),
          statusCode: 400,
        });
      }
      const body = parsed.data;

      const store = await getConnectionStore(app.prisma);

      if (!hasEncryptionKey()) {
        return reply.code(503).send({
          error:
            "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
          statusCode: 503,
        });
      }

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
        connection: redactCredentials(connection),
      });
    },
  );

  // GET /api/connections — list connections (org-scoped, creds redacted)
  app.get(
    "/",
    {
      schema: {
        description: "List all connections for the authenticated organization.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const store = await getConnectionStore(app.prisma);
      let connections;
      try {
        connections = await store.list(organizationId);
      } catch (err) {
        if (err instanceof Error && err.message.includes("CREDENTIALS_ENCRYPTION_KEY")) {
          return reply.code(503).send({
            error:
              "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
            statusCode: 503,
          });
        }
        throw err;
      }

      return reply.code(200).send({
        connections: connections.map(redactCredentials),
      });
    },
  );

  // GET /api/connections/:id — get one connection (creds redacted)
  app.get(
    "/:id",
    {
      schema: {
        description: "Get a single connection by ID.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const { id } = request.params as { id: string };
      const store = await getConnectionStore(app.prisma);
      let connection;
      try {
        connection = await store.getById(id);
      } catch (err) {
        if (err instanceof Error && err.message.includes("CREDENTIALS_ENCRYPTION_KEY")) {
          return reply.code(503).send({
            error:
              "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
            statusCode: 503,
          });
        }
        throw err;
      }

      if (!connection || connection.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
      }

      return reply.code(200).send({ connection: redactCredentials(connection) });
    },
  );

  // PUT /api/connections/:id — update connection via save() (upsert)
  app.put(
    "/:id",
    {
      schema: {
        description: "Update an existing connection.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const { id } = request.params as { id: string };
      const parsed = UpdateConnectionBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join("; "),
          statusCode: 400,
        });
      }
      const body = parsed.data;

      if (!hasEncryptionKey()) {
        return reply.code(503).send({
          error:
            "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
          statusCode: 503,
        });
      }

      const store = await getConnectionStore(app.prisma);
      const existing = await store.getById(id);

      if (!existing || existing.organizationId !== organizationId) {
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
    },
  );

  // DELETE /api/connections/:id — remove connection
  app.delete(
    "/:id",
    {
      schema: {
        description: "Delete a connection by ID.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const { id } = request.params as { id: string };
      const store = await getConnectionStore(app.prisma);
      const existing = await store.getById(id);

      if (!existing || existing.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
      }

      await store.delete(id);
      return reply.code(200).send({ id, deleted: true });
    },
  );

  // POST /api/connections/:id/test — test connection health
  app.post(
    "/:id/test",
    {
      schema: {
        description: "Test a connection by running the cartridge healthCheck.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const { id } = request.params as { id: string };
      const store = await getConnectionStore(app.prisma);
      const connection = await store.getById(id);

      if (!connection || connection.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
      }

      // Try to find the cartridge that uses this service
      const cartridgeIds = app.storageContext.cartridges.list();
      let healthResult: { healthy: boolean; detail?: string } = {
        healthy: false,
        detail: "No matching cartridge found",
      };

      for (const cId of cartridgeIds) {
        const cartridge = app.storageContext.cartridges.get(cId);
        if (!cartridge) continue;
        const manifest = cartridge.manifest;
        const required = manifest.requiredConnections ?? [];
        if (required.some((rc: string) => rc === connection.serviceId)) {
          // Found a matching cartridge — check if it has healthCheck
          try {
            await cartridge.healthCheck();
            healthResult = { healthy: true };
          } catch (err: unknown) {
            healthResult = {
              healthy: false,
              detail: err instanceof Error ? err.message : String(err),
            };
          }
          break;
        }
      }

      await store.updateStatus(id, healthResult.healthy ? "connected" : "error");

      return reply.code(200).send(healthResult);
    },
  );
};
