// ---------------------------------------------------------------------------
// Route registration — all API route prefixes
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { ConsentService, ContactConsentReader } from "@switchboard/core";
import { registerAdminConsentRoutes } from "../routes/admin-consent.js";
import { actionsRoutes } from "../routes/actions.js";
import { actionLifecycleRoutes } from "../routes/action-lifecycle.js";
import { executeRoutes } from "../routes/execute.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { recommendationsRoutes } from "../routes/recommendations.js";
import { dashboardAgentsRoutes } from "../routes/dashboard-agents.js";
import { decisionsRoutes } from "../routes/decisions.js";
import { greetingRoutes } from "../routes/greeting.js";
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
import { whatsappManagementRoutes } from "../routes/whatsapp-management.js";
import { whatsappSendTestRoutes } from "../routes/whatsapp-send-test.js";
import { whatsappTemplateCreateRoutes } from "../routes/whatsapp-template-create.js";
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
import { metaDeletionRoutes } from "../routes/meta-deletion.js";
import { googleCalendarOAuthRoutes } from "../routes/google-calendar-oauth.js";
import { dashboardReportsRoutes } from "../routes/dashboard-reports.js";
import { dashboardContactsRoutes } from "../routes/dashboard-contacts.js";
import { dashboardContactDetailRoutes } from "../routes/dashboard-contact-detail.js";
import { dashboardOpportunitiesRoutes } from "../routes/dashboard-opportunities.js";
import { dashboardAutomationsRoutes } from "../routes/dashboard-automations.js";
import { dashboardActivityRoutes } from "../routes/dashboard-activity.js";
import { winsRoute } from "../routes/agent-home/wins.js";
import { pipelineRoute } from "../routes/agent-home/pipeline.js";
import { creativesRoute } from "../routes/agent-home/creatives.js";
import { metricsRoute } from "../routes/agent-home/metrics.js";
import { missionRoute } from "../routes/agent-home/mission.js";
import { cockpitActivityRoutes } from "../routes/agent-home/activity.js";
import { buildCockpitActivityDeps } from "../lib/cockpit-activity-deps.js";
import { registerLifecycleDisqualificationsRoutes } from "../routes/lifecycle-disqualifications.js";
import type { LifecycleDisqualificationsRouteDeps } from "../routes/lifecycle-disqualifications.js";
import { registerRileyOutcomesRoute } from "../routes/cockpit/riley/outcomes.js";

export interface RegisterRoutesDeps {
  /**
   * Read-side consent state. Phase 1b.4 migrated mutating consent calls to
   * PlatformIngress; the ConsentService now lives in operator-intent handlers,
   * not the route deps. Only the reader is needed here for the GET endpoint
   * and the post-mutation state read.
   */
  consentReader?: ContactConsentReader;
  /**
   * Gate-only reference to the ConsentService. The service is wired into
   * `bootstrapOperatorIntents` (where the actual write handlers live); here it
   * is consulted only to confirm that the write intents have been registered
   * before the admin route is exposed. If a future bootstrap mode produces a
   * `consentReader` without a `consentService`, the admin POST routes would
   * 500 at `platformIngress.submit` with "intent not found"; requiring both
   * here means the route is registered iff its handlers exist (defense-in-depth
   * called out by Phase 1b.4 code review).
   */
  consentService?: ConsentService;
  /** Phase 3b: lifecycle disqualification API deps. Only wired when Prisma is available. */
  lifecycleDisqualifications?: LifecycleDisqualificationsRouteDeps;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps?: RegisterRoutesDeps,
): Promise<void> {
  // Setup routes are registered before auth — bootstrap needs to work pre-auth
  await app.register(setupRoutes, { prefix: "/api/setup" });
  await app.register(actionsRoutes, { prefix: "/api/actions" });
  // Lifecycle transitions (/:id/execute, /:id/undo) share the /api/actions prefix
  // so URLs are unchanged; they are a distinct route-class (lifecycle) per #654.
  await app.register(actionLifecycleRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(recommendationsRoutes, { prefix: "/api/recommendations" });
  await app.register(dashboardAgentsRoutes, { prefix: "/api/dashboard/agents" });
  // decisionsRoutes registers two paths under /api/dashboard:
  //   GET /agents/:key/decisions  — per-agent feed
  //   GET /decisions              — cross-agent inbox
  await app.register(decisionsRoutes, { prefix: "/api/dashboard" });
  // winsRoute: GET /api/dashboard/agents/:agentId/wins — agent-home wins feed
  await app.register(winsRoute, { prefix: "/api/dashboard" });
  // pipelineRoute: GET /api/dashboard/agents/:agentId/pipeline — agent-home pipeline feed
  await app.register(pipelineRoute, { prefix: "/api/dashboard" });
  // creativesRoute: GET /api/dashboard/agents/:agentId/creatives — Mira creative review feed
  await app.register(creativesRoute, { prefix: "/api/dashboard" });
  // metricsRoute: GET /api/dashboard/agents/:agentId/metrics — agent-home metrics feed
  await app.register(metricsRoute, { prefix: "/api/dashboard" });
  // missionRoute: GET /api/dashboard/agents/:agentId/mission — agent-home mission aggregator
  await app.register(missionRoute, { prefix: "/api/dashboard" });
  // cockpitActivityRoutes: GET /api/dashboard/agents/:agentId/activity — A.4 cockpit feed.
  // Only registered when Prisma is available; deps wrap Prisma to fetch org-scoped audit
  // entries (×4 over-fetch for the in-TS agent filter) and batch ConversationMessage previews.
  if (app.prisma) {
    const cockpitActivityDeps = buildCockpitActivityDeps(app.prisma);
    await app.register(cockpitActivityRoutes(cockpitActivityDeps), {
      prefix: "/api/dashboard",
    });
    // Riley outcomes route: GET /api/cockpit/riley/outcomes
    // Gated on Prisma; store filters cockpitRenderable=true at the SQL layer.
    const { PrismaRecommendationOutcomeStore } = await import("@switchboard/db");
    const recommendationOutcomeStore = new PrismaRecommendationOutcomeStore(app.prisma);
    await registerRileyOutcomesRoute(app, {
      listRenderable: ({ orgId, limit }) =>
        recommendationOutcomeStore.listRenderableForOrg({ orgId, agentRole: "riley", limit }),
    });
  }
  // greetingRoutes: GET /api/dashboard/agents/:agentKey/greeting — agent-home greeting block
  await app.register(greetingRoutes, { prefix: "/api/dashboard" });
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
    chatPublicUrl: process.env.CHAT_PUBLIC_URL ?? process.env.SWITCHBOARD_CHAT_URL,
    internalApiSecret: process.env.INTERNAL_API_SECRET,
    graphApiFetch: async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init);
      return (await res.json()) as Record<string, unknown>;
    },
    createConnection: async (data) => {
      const encrypted = (await import("@switchboard/db")).encryptCredentials({
        token: data.wabaId,
        phoneNumberId: data.phoneNumberId,
        primaryPhoneNumberId: data.phoneNumberId,
        displayPhoneNumber: data.displayPhoneNumber,
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
          externalAccountId: data.wabaId,
        },
      });
      return { id: conn.id, webhookPath: `/webhook/managed/${conn.id}` };
    },
  });
  await app.register(whatsappManagementRoutes, { prefix: "/api/dashboard/whatsapp" });
  await app.register(whatsappSendTestRoutes, { prefix: "/api/dashboard/whatsapp" });
  await app.register(whatsappTemplateCreateRoutes, { prefix: "/api/dashboard/whatsapp" });
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
  // "/api/marketplace" is the historical prefix for the live provisioning backbone
  // (listings, deployments, tasks, trust progression) — NOT a storefront. The
  // customer-facing storefront is the distinct "/api/storefront" prefix below. Do
  // not rename this prefix opportunistically; it is a wire contract consumed by the
  // dashboard. See docs/DOCTRINE.md → "Marketplace namespace (historical, but live)".
  await app.register(marketplaceRoutes, { prefix: "/api/marketplace" });
  await app.register(marketplacePersonaRoutes, { prefix: "/api/marketplace" });
  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
  await app.register(onboardRoutes, { prefix: "/api/marketplace" });
  await app.register(storefrontRoutes, { prefix: "/api/storefront" });
  await app.register(deploymentMemoryRoutes, { prefix: "/api/marketplace" });
  await app.register(adOptimizerRoutes, { prefix: "/api/marketplace" });
  await app.register(revenueRoutes, { prefix: "/api" });
  await app.register(roiRoutes, { prefix: "/api" });
  await app.register(ingressRoutes, { prefix: "/api" });
  await app.register(dashboardOverviewRoutes, { prefix: "/api" });
  await app.register(ownerTaskRoutes, { prefix: "/api" });
  await app.register(organizationsRoutes, { prefix: "/api/organizations", apiVersion: "v21.0" });
  await app.register(billingRoutes, { prefix: "/api/billing" });
  await app.register(metaDeletionRoutes, { prefix: "/api/meta/deletion" });
  await app.register(dashboardReportsRoutes);
  await app.register(dashboardContactsRoutes);
  await app.register(dashboardContactDetailRoutes);
  await app.register(dashboardOpportunitiesRoutes);
  await app.register(dashboardAutomationsRoutes);
  await app.register(dashboardActivityRoutes, { prefix: "/api/dashboard/activity" });
  // playbook, simulate, and website-scan routes define their own full paths including /api prefix
  await app.register(playbookRoutes);
  await app.register(simulateRoutes);
  await app.register(websiteScanRoutes);

  // Phase 3b — lifecycle disqualifications API.
  // Only registered when Prisma-backed lifecycle deps are wired.
  if (deps?.lifecycleDisqualifications) {
    await registerLifecycleDisqualificationsRoutes(app, deps.lifecycleDisqualifications);
  }

  // Phase 1c — admin consent endpoint. Phase 1b.4 migrated POST routes to
  // PlatformIngress; the ConsentService is now invoked from operator-intent
  // handlers registered in `bootstrap/operator-intents.ts`. The route only
  // needs the read-side ContactConsentReader for post-mutation state reads
  // (non-mutating; stays outside ingress).
  //
  // Gate on BOTH consentService AND consentReader: the service presence
  // confirms that bootstrapOperatorIntents registered the grant/revoke/clear
  // intents. Without it, POST routes would 500 at submit time with "intent
  // not found." Both come from the same `bootstrapSkillMode` call today, but
  // future bootstrap modes might diverge (Phase 1b.4 review-followup #4).
  if (deps?.consentReader && deps?.consentService) {
    registerAdminConsentRoutes(app, {
      consentReader: deps.consentReader,
    });
  }
}
