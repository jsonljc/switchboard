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
import { knowledgeEntryRoutes } from "../routes/knowledge-entries.js";
import { escalationsRoutes } from "../routes/escalations.js";
import { sessionRoutes } from "../routes/sessions.js";
import { workflowRoutes } from "../routes/workflows.js";
import { marketplaceRoutes } from "../routes/marketplace.js";
import { marketplacePersonaRoutes } from "../routes/marketplace-persona.js";
import { creativePipelineRoutes } from "../routes/creative-pipeline.js";
import { onboardRoutes } from "../routes/onboard.js";
import { storefrontRoutes } from "../routes/storefront.js";
import { deploymentMemoryRoutes } from "../routes/deployment-memory.js";
import { adOptimizerRoutes } from "../routes/ad-optimizer.js";
import { facebookOAuthRoutes } from "../routes/facebook-oauth.js";
import { whatsappTestRoutes } from "../routes/whatsapp-test.js";
import { whatsappOnboardingRoutes } from "../routes/whatsapp-onboarding.js";
import { leadsInboundRoutes } from "../routes/leads-inbound.js";
import { revenueRoutes } from "../routes/revenue.js";
import { roiRoutes } from "../routes/roi.js";
import { ingressRoutes } from "../routes/ingress.js";
import { playbookRoutes } from "../routes/playbook.js";
import { dashboardOverviewRoutes } from "../routes/dashboard-overview.js";
import websiteScanRoutes from "../routes/website-scan.js";
import { ownerTaskRoutes } from "../routes/owner-tasks.js";
import { organizationsRoutes } from "../routes/organizations.js";
import { simulateRoutes } from "../routes/simulate.js";
import { readinessRoutes } from "../routes/readiness.js";
import { billingRoutes } from "../routes/billing.js";
import { googleCalendarOAuthRoutes } from "../routes/google-calendar-oauth.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Setup routes are registered before auth — bootstrap needs to work pre-auth
  await app.register(setupRoutes, { prefix: "/api/setup" });
  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(connectionsRoutes, { prefix: "/api/connections" });
  await app.register(facebookOAuthRoutes, { prefix: "/api/connections" });
  await app.register(whatsappTestRoutes, { prefix: "/api/connections" });
  await app.register(whatsappOnboardingRoutes, {
    prefix: "/api/whatsapp",
    metaSystemUserToken: process.env.META_SYSTEM_USER_TOKEN ?? "",
    metaSystemUserId: process.env.META_SYSTEM_USER_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    apiVersion: "v21.0",
    webhookBaseUrl: process.env.CHAT_PUBLIC_URL ?? "http://localhost:3001",
    graphApiFetch: async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init);
      return (await res.json()) as Record<string, unknown>;
    },
    createConnection: async (data) => {
      const encrypted = (await import("@switchboard/db")).encryptCredentials({
        token: data.wabaId,
        phoneNumberId: data.phoneNumberId,
      });
      const conn = await app.prisma!.connection.create({
        data: {
          id: `conn_${crypto.randomUUID().slice(0, 8)}`,
          organizationId: "",
          serviceId: "whatsapp",
          serviceName: "whatsapp",
          authType: "bot_token",
          credentials: encrypted,
          scopes: [],
        },
      });
      return { id: conn.id, webhookPath: `/webhook/managed/${conn.id}` };
    },
  });
  await app.register(googleCalendarOAuthRoutes, { prefix: "/api/connections" });
  await app.register(dlqRoutes, { prefix: "/api/dlq" });
  await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });
  await app.register(competenceRoutes, { prefix: "/api/competence" });
  await app.register(webhooksRoutes, { prefix: "/api/webhooks" });
  await app.register(governanceRoutes, { prefix: "/api/governance" });
  await app.register(conversationsRoutes, { prefix: "/api/conversations" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(readinessRoutes, { prefix: "/api/agents" });
  await app.register(knowledgeRoutes, { prefix: "/api/knowledge" });
  await app.register(knowledgeEntryRoutes, { prefix: "/api/knowledge-entries" });
  await app.register(escalationsRoutes, { prefix: "/api/escalations" });
  await app.register(sessionRoutes, { prefix: "/api/sessions" });
  await app.register(workflowRoutes, { prefix: "/api/workflows" });
  await app.register(marketplaceRoutes, { prefix: "/api/marketplace" });
  await app.register(marketplacePersonaRoutes, { prefix: "/api/marketplace" });
  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
  await app.register(onboardRoutes, { prefix: "/api/marketplace" });
  await app.register(storefrontRoutes, { prefix: "/api/storefront" });
  await app.register(deploymentMemoryRoutes, { prefix: "/api/marketplace" });
  await app.register(adOptimizerRoutes, { prefix: "/api/marketplace" });
  await app.register(revenueRoutes, { prefix: "/api" });
  await app.register(leadsInboundRoutes, { prefix: "/api" });
  await app.register(roiRoutes, { prefix: "/api" });
  await app.register(ingressRoutes, { prefix: "/api" });
  await app.register(dashboardOverviewRoutes, { prefix: "/api" });
  await app.register(ownerTaskRoutes, { prefix: "/api" });
  await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  await app.register(billingRoutes, { prefix: "/api/billing" });
  // playbook, simulate, and website-scan routes define their own full paths including /api prefix
  await app.register(playbookRoutes);
  await app.register(simulateRoutes);
  await app.register(websiteScanRoutes);
}
