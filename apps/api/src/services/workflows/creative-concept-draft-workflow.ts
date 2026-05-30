import type { WorkflowHandler } from "@switchboard/core/platform";

/** Minimal store surfaces this handler needs (real Prisma stores satisfy these). */
export interface CreativeConceptDraftDeps {
  taskStore: {
    create(input: {
      deploymentId: string;
      organizationId: string;
      listingId: string;
      category: string;
      input?: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
  jobStore: {
    create(input: {
      taskId: string;
      organizationId: string;
      deploymentId: string;
      productDescription: string;
      targetAudience: string;
      platforms: string[];
      brandVoice: string | null;
      productImages: string[];
      references: string[];
      pastPerformance: Record<string, unknown> | null;
      generateReferenceImages: boolean;
    }): Promise<{ id: string }>;
  };
  deploymentStore: {
    findById(id: string): Promise<{ listingId: string; organizationId: string } | null>;
  };
  enablementStore: { list(orgId: string): Promise<Array<{ agentKey: string; status: string }>> };
}

interface ConceptBrief {
  productDescription: string;
  targetAudience: string;
  platforms?: string[];
  brandVoice?: string | null;
  productImages?: string[];
  references?: string[];
  pastPerformance?: Record<string, unknown> | null;
  generateReferenceImages?: boolean;
}

/**
 * Draft-only Alex→Mira handoff. Creates a CreativeJob row (default currentStage
 * "trends" → Mira read-model status "in_progress"/"Drafting" on /mira) WITHOUT
 * firing the creative pipeline — the entire "no spend" guarantee is that this
 * module never imports @switchboard/creative-pipeline. Gated on Mira enablement.
 */
export function buildCreativeConceptDraftWorkflow(deps: CreativeConceptDraftDeps): WorkflowHandler {
  return {
    async execute(workUnit) {
      const orgId = workUnit.organizationId;

      // Mira is opt-in per org (no global flip). Canonical check mirrors
      // apps/api/src/lib/agent-home-access.ts isAgentHomeAccessible("mira", ...).
      const enablement = await deps.enablementStore.list(orgId);
      const miraEnabled = enablement.some((r) => r.agentKey === "mira" && r.status === "enabled");
      if (!miraEnabled) {
        return {
          outcome: "completed",
          summary: "Mira not enabled for this organization — concept draft skipped",
          outputs: { skipped: true, reason: "mira_not_enabled" },
        };
      }

      // The child WorkUnit's deployment was resolved for intent
      // "creative.concept.draft" (skillSlug "creative"). DeploymentContext drops
      // listingId, so resolve it from the deployment row. A literal "api-direct"
      // fallback (no active creative deployment) returns null here → fail closed.
      const deploymentId = workUnit.deployment?.deploymentId;
      if (!deploymentId) {
        return {
          outcome: "failed",
          summary: "No deployment on work unit",
          error: {
            code: "DEPLOYMENT_NOT_FOUND",
            message: "Child work unit has no deployment context.",
          },
        };
      }
      const deployment = await deps.deploymentStore.findById(deploymentId);
      if (!deployment) {
        return {
          outcome: "failed",
          summary: "No active creative deployment resolved for this organization",
          outputs: { deploymentId },
          error: {
            code: "DEPLOYMENT_NOT_FOUND",
            message: `No AgentDeployment for id=${deploymentId}; a creative deployment (skillSlug="creative", status="active") must exist.`,
          },
        };
      }
      // Defense-in-depth: deploymentId was resolved org-scoped upstream, but never
      // trust a cross-tenant read. Conflate mismatch with not-found (don't leak existence).
      if (deployment.organizationId !== orgId) {
        return {
          outcome: "failed",
          summary: "Resolved deployment does not belong to this organization",
          error: { code: "DEPLOYMENT_NOT_FOUND", message: "Deployment org mismatch." },
        };
      }

      const brief = (workUnit.parameters as { brief?: ConceptBrief }).brief;
      if (!brief?.productDescription || !brief?.targetAudience) {
        return {
          outcome: "failed",
          summary: "Concept brief missing required fields",
          error: {
            code: "INVALID_BRIEF",
            message: "brief.productDescription and brief.targetAudience are required.",
          },
        };
      }

      const task = await deps.taskStore.create({
        deploymentId,
        organizationId: orgId,
        listingId: deployment.listingId,
        category: "creative_strategy",
        input: brief as unknown as Record<string, unknown>,
      });

      const job = await deps.jobStore.create({
        taskId: task.id,
        organizationId: orgId,
        deploymentId,
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        platforms: brief.platforms ?? ["instagram"],
        brandVoice: brief.brandVoice ?? null,
        productImages: brief.productImages ?? [],
        references: brief.references ?? [],
        pastPerformance: brief.pastPerformance ?? null,
        generateReferenceImages: brief.generateReferenceImages ?? false,
      });

      // NO inngestClient.send — draft-only, no spend.
      return {
        outcome: "completed",
        summary: "Creative concept draft created for Mira review",
        outputs: { jobId: job.id },
      };
    },
  };
}
