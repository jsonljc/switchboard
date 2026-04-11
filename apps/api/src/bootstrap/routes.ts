// ---------------------------------------------------------------------------
// Route registration — all API route prefixes
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { executeRoutes } from "../routes/execute.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { policiesRoutes } from "../routes/policies.js";
import { auditRoutes } from "../routes/audit.js";
import { identityRoutes } from "../routes/identity.js";
import { simulateRoutes } from "../routes/simulate.js";
import { healthRoutes } from "../routes/health.js";
import { connectionsRoutes } from "../routes/connections.js";
import { dlqRoutes } from "../routes/dlq.js";
import { tokenUsageRoutes } from "../routes/token-usage.js";
import { competenceRoutes } from "../routes/competence.js";
import { webhooksRoutes } from "../routes/webhooks.js";
import { governanceRoutes } from "../routes/governance.js";
import { conversationsRoutes } from "../routes/conversations.js";
import { agentsRoutes } from "../routes/agents.js";
import { setupRoutes } from "../routes/setup.js";
import { knowledgeRoutes } from "../routes/knowledge.js";
import { escalationsRoutes } from "../routes/escalations.js";
import { sessionRoutes } from "../routes/sessions.js";
import { agentConversationRoutes } from "../routes/conversation.js";
import { workflowRoutes } from "../routes/workflows.js";
import { schedulerRoutes } from "../routes/scheduler.js";
import { operatorRoutes } from "../routes/operator.js";
import { marketplaceRoutes } from "../routes/marketplace.js";
import { marketplacePersonaRoutes } from "../routes/marketplace-persona.js";
import { creativePipelineRoutes } from "../routes/creative-pipeline.js";
import { onboardRoutes } from "../routes/onboard.js";
import { storefrontRoutes } from "../routes/storefront.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Setup routes are registered before auth — bootstrap needs to work pre-auth
  await app.register(setupRoutes, { prefix: "/api/setup" });
  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(simulateRoutes, { prefix: "/api/simulate" });
  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(connectionsRoutes, { prefix: "/api/connections" });
  await app.register(dlqRoutes, { prefix: "/api/dlq" });
  await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });
  await app.register(competenceRoutes, { prefix: "/api/competence" });
  await app.register(webhooksRoutes, { prefix: "/api/webhooks" });
  await app.register(governanceRoutes, { prefix: "/api/governance" });
  await app.register(conversationsRoutes, { prefix: "/api/conversations" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(knowledgeRoutes, { prefix: "/api/knowledge" });
  await app.register(escalationsRoutes, { prefix: "/api/escalations" });
  await app.register(sessionRoutes, { prefix: "/api/sessions" });
  await app.register(agentConversationRoutes, { prefix: "/api/conversation" });
  await app.register(workflowRoutes, { prefix: "/api/workflows" });
  await app.register(schedulerRoutes, { prefix: "/api/scheduler" });
  await app.register(operatorRoutes, { prefix: "/api/operator" });
  await app.register(marketplaceRoutes, { prefix: "/api/marketplace" });
  await app.register(marketplacePersonaRoutes, { prefix: "/api/marketplace" });
  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
  await app.register(onboardRoutes, { prefix: "/api/marketplace" });
  await app.register(storefrontRoutes, { prefix: "/api/storefront" });
}
