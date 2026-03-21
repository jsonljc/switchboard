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
import { interpretersRoutes } from "../routes/interpreters.js";
import { cartridgesRoutes } from "../routes/cartridges.js";
import { connectionsRoutes } from "../routes/connections.js";
import { organizationsRoutes } from "../routes/organizations.js";
import { dlqRoutes } from "../routes/dlq.js";
import { tokenUsageRoutes } from "../routes/token-usage.js";
import { alertsRoutes } from "../routes/alerts.js";
import { scheduledReportsRoutes } from "../routes/scheduled-reports.js";
import { crmRoutes } from "../routes/crm.js";
import { competenceRoutes } from "../routes/competence.js";
import { webhooksRoutes } from "../routes/webhooks.js";
import { inboundWebhooksRoutes } from "../routes/inbound-webhooks.js";
import { inboundMessagesRoutes } from "../routes/inbound-messages.js";
import { smbRoutes } from "../routes/smb.js";
import { governanceRoutes } from "../routes/governance.js";
import { campaignsRoutes } from "../routes/campaigns.js";
import { reportsRoutes } from "../routes/reports.js";
import { conversationsRoutes } from "../routes/conversations.js";
import { agentsRoutes } from "../routes/agents.js";
import { operatorConfigRoutes } from "../routes/operator-config.js";
import { revenueGrowthRoutes } from "../routes/revenue-growth.js";
import { businessConfigRoutes } from "../routes/business-config.js";
import { flowBuilderRoutes } from "../routes/flow-builder.js";
import { deploymentRoutes } from "../routes/deployment.js";
import { setupRoutes } from "../routes/setup.js";
import { revenueRoutes } from "../routes/revenue.js";
import { handoffRoutes } from "../routes/handoff.js";
import { knowledgeRoutes } from "../routes/knowledge.js";
import { testChatRoutes } from "../routes/test-chat.js";
import { escalationsRoutes } from "../routes/escalations.js";

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
  await app.register(interpretersRoutes, { prefix: "/api/interpreters" });
  await app.register(cartridgesRoutes, { prefix: "/api/cartridges" });
  await app.register(connectionsRoutes, { prefix: "/api/connections" });
  await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  await app.register(dlqRoutes, { prefix: "/api/dlq" });
  await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });
  await app.register(alertsRoutes, { prefix: "/api/alerts" });
  await app.register(scheduledReportsRoutes, { prefix: "/api/scheduled-reports" });
  await app.register(crmRoutes, { prefix: "/api/crm" });
  await app.register(competenceRoutes, { prefix: "/api/competence" });
  await app.register(webhooksRoutes, { prefix: "/api/webhooks" });
  await app.register(inboundWebhooksRoutes, { prefix: "/api/inbound" });
  await app.register(inboundMessagesRoutes, { prefix: "/api/messages" });
  await app.register(smbRoutes, { prefix: "/api/smb" });
  await app.register(governanceRoutes, { prefix: "/api/governance" });
  await app.register(campaignsRoutes, { prefix: "/api/campaigns" });
  await app.register(reportsRoutes, { prefix: "/api/reports" });
  await app.register(conversationsRoutes, { prefix: "/api/conversations" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(operatorConfigRoutes, { prefix: "/api/operator-config" });
  await app.register(revenueGrowthRoutes, { prefix: "/api/revenue-growth" });
  await app.register(businessConfigRoutes, { prefix: "/api/business-config" });
  await app.register(flowBuilderRoutes, { prefix: "/api/flows" });
  await app.register(deploymentRoutes, { prefix: "/api/deployment" });
  await app.register(revenueRoutes, { prefix: "/api/revenue" });
  await app.register(handoffRoutes, { prefix: "/api/handoff" });
  await app.register(knowledgeRoutes, { prefix: "/api/knowledge" });
  await app.register(testChatRoutes, { prefix: "/api/test-chat" });
  await app.register(escalationsRoutes, { prefix: "/api/escalations" });
}
