import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

/**
 * Register OpenAPI documentation and optional Swagger UI.
 */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Switchboard API",
        description: "AI agent guardrail and approval orchestration API",
        version: "0.1.0",
      },
      tags: [
        { name: "Actions", description: "Propose, execute, undo, and batch actions" },
        {
          name: "Execute",
          description:
            "Single endpoint: propose + conditional execute (EXECUTED | PENDING_APPROVAL | DENIED)",
        },
        {
          name: "Approvals",
          description: "Respond to approval requests and list pending approvals",
        },
        { name: "Simulate", description: "Dry-run action evaluation without side effects" },
        { name: "Policies", description: "CRUD operations for guardrail policies" },
        { name: "Identity", description: "Manage identity specs and role overlays" },
        { name: "Audit", description: "Query audit ledger and verify chain integrity" },
        { name: "Health", description: "Health and readiness checks" },
        { name: "Interpreters", description: "Natural-language action interpretation" },
        { name: "Cartridges", description: "Registered cartridge manifests and metadata" },
        { name: "Connections", description: "Service connection credential management" },
        { name: "Organizations", description: "Organization provisioning and configuration" },
        { name: "DLQ", description: "Dead letter queue for failed inbound messages" },
        { name: "Token Usage", description: "LLM token usage tracking and reporting" },
        { name: "Alerts", description: "Alert rules and notifications" },
        { name: "Scheduled Reports", description: "Automated reporting schedules" },
        { name: "CRM", description: "CRM entity management (contacts, deals, activities)" },
        { name: "Competence", description: "Agent competence assessment and tracking" },
        { name: "Webhooks", description: "Outbound webhook configuration" },
        { name: "Inbound", description: "Inbound webhook receivers (Telegram, Slack, WhatsApp)" },
        { name: "Messages", description: "Inbound message processing and routing" },
        { name: "Governance", description: "Governance profiles and emergency halt" },
        {
          name: "Marketplace",
          description: "Agent listings, deployments, tasks, and trust scores",
        },
        { name: "Conversations", description: "Conversation listing and management" },
        { name: "Agents", description: "Agent roster and activity state management" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "API key passed as Bearer token. Set API_KEYS env var to enable.",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  // Only expose Swagger UI outside production (or when explicitly enabled)
  if (process.env.NODE_ENV !== "production" || process.env["ENABLE_SWAGGER"] === "true") {
    await app.register(swaggerUi, {
      routePrefix: "/docs",
    });
  }
}
