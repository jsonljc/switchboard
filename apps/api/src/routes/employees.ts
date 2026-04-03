import type { FastifyPluginAsync } from "fastify";
import { PrismaEmployeeStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export const employeesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/employees — list all employees for the org
  app.get(
    "/",
    {
      schema: {
        description: "List all registered AI employees for the organization.",
        tags: ["Employees"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const store = new PrismaEmployeeStore(app.prisma);
      const employees = await store.getByOrg(orgId);

      return reply.code(200).send({ employees });
    },
  );

  // GET /api/employees/:employeeId — get a single employee
  app.get(
    "/:employeeId",
    {
      schema: {
        description: "Get a specific AI employee by ID.",
        tags: ["Employees"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { employeeId } = request.params as { employeeId: string };
      const store = new PrismaEmployeeStore(app.prisma);
      const employee = await store.getById(employeeId, orgId);

      if (!employee) {
        return reply.code(404).send({ error: "Employee not found", statusCode: 404 });
      }

      return reply.code(200).send({ employee });
    },
  );

  // POST /api/employees/register — register (hire) an employee for the org
  app.post(
    "/register",
    {
      schema: {
        description: "Register an AI employee for the organization.",
        tags: ["Employees"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const body = request.body as {
        employeeId: string;
        config?: Record<string, unknown>;
      };

      if (!body.employeeId) {
        return reply.code(400).send({ error: "employeeId is required", statusCode: 400 });
      }

      const store = new PrismaEmployeeStore(app.prisma);
      await store.register(body.employeeId, orgId, body.config);

      const employee = await store.getById(body.employeeId, orgId);

      return reply.code(201).send({ employee });
    },
  );

  // PATCH /api/employees/:employeeId/status — update employee status
  app.patch(
    "/:employeeId/status",
    {
      schema: {
        description: "Update an AI employee's status (active, paused, terminated).",
        tags: ["Employees"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { employeeId } = request.params as { employeeId: string };
      const body = request.body as { status: string };

      if (!body.status) {
        return reply.code(400).send({ error: "status is required", statusCode: 400 });
      }

      const store = new PrismaEmployeeStore(app.prisma);

      try {
        await store.updateStatus(employeeId, orgId, body.status);
      } catch {
        return reply.code(404).send({ error: "Employee not found", statusCode: 404 });
      }

      const employee = await store.getById(employeeId, orgId);
      return reply.code(200).send({ employee });
    },
  );

  // PATCH /api/employees/:employeeId/config — update employee config
  app.patch(
    "/:employeeId/config",
    {
      schema: {
        description: "Update an AI employee's configuration.",
        tags: ["Employees"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { employeeId } = request.params as { employeeId: string };
      const body = request.body as { config: Record<string, unknown> };

      if (!body.config) {
        return reply.code(400).send({ error: "config is required", statusCode: 400 });
      }

      const store = new PrismaEmployeeStore(app.prisma);

      try {
        await store.updateConfig(employeeId, orgId, body.config);
      } catch {
        return reply.code(404).send({ error: "Employee not found", statusCode: 404 });
      }

      const employee = await store.getById(employeeId, orgId);
      return reply.code(200).send({ employee });
    },
  );
};
