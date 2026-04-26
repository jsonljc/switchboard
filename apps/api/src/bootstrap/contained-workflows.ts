import type {
  ExecutionModeRegistry,
  WorkflowHandler,
  DeploymentResolver,
} from "@switchboard/core/platform";
import { WorkflowMode } from "@switchboard/core/platform";
import type { IntentRegistry } from "@switchboard/core/platform";
import type { PlatformIngress, SubmitWorkResponse } from "@switchboard/core/platform";
import type { ChildWorkRequest } from "@switchboard/core/platform";
import type { InstantFormAdapter } from "@switchboard/ad-optimizer";
import { resolveDeploymentForIntent } from "../utils/resolve-deployment.js";

interface ContainedWorkflowBootstrapDeps {
  prismaClient: unknown;
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  platformIngress: PlatformIngress;
  deploymentResolver: DeploymentResolver | null;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export interface ContainedWorkflowBootstrapResult {
  /**
   * The single InstantFormAdapter instance shared across all IF Contact-creation
   * paths (workflow + lead-retry cron). Cron deps must reuse this instance to
   * preserve the "no parallel mutation paths" doctrine.
   */
  instantFormAdapter: InstantFormAdapter;
}

export async function bootstrapContainedWorkflows(
  deps: ContainedWorkflowBootstrapDeps,
): Promise<ContainedWorkflowBootstrapResult> {
  const {
    prismaClient,
    intentRegistry,
    modeRegistry,
    platformIngress,
    deploymentResolver,
    logger,
  } = deps;

  const { buildCreativeJobSubmitWorkflow } =
    await import("../services/workflows/creative-job-submit-workflow.js");
  const { buildCreativeJobDecisionWorkflow } =
    await import("../services/workflows/creative-job-decision-workflow.js");
  const { buildMetaLeadIntakeWorkflow } =
    await import("../services/workflows/meta-lead-intake-workflow.js");
  const { buildMetaLeadGreetingWorkflow } =
    await import("../services/workflows/meta-lead-greeting-workflow.js");
  const { buildMetaLeadRecordInquiryWorkflow } =
    await import("../services/workflows/meta-lead-record-inquiry-workflow.js");
  const { LeadIntakeHandler, buildLeadIntakeWorkflow } = await import("@switchboard/core");
  const { PrismaLeadIntakeStore } = await import("@switchboard/db");
  const { InstantFormAdapter } = await import("@switchboard/ad-optimizer");

  // Single source of truth for Contact creation from leads (CTWA + Instant Form).
  // The meta.lead.intake workflow orchestrates the IF webhook (Graph fetch +
  // child work dispatch), but delegates the actual Contact write to
  // LeadIntakeHandler via the InstantFormAdapter, which goes through the
  // PlatformIngress front door.
  const leadIntakeStore = new PrismaLeadIntakeStore(
    prismaClient as ConstructorParameters<typeof PrismaLeadIntakeStore>[0],
  );
  const leadIntakeHandler = new LeadIntakeHandler({ store: leadIntakeStore });
  const instantFormAdapter = new InstantFormAdapter({
    ingress: {
      submit: async (req) => {
        const payload = req.payload as {
          organizationId: string;
          deploymentId: string;
        };
        const response = await platformIngress.submit({
          organizationId: payload.organizationId,
          actor: { id: "system:meta-lead-intake", type: "system" },
          intent: req.intent,
          parameters: req.payload as Record<string, unknown>,
          trigger: "internal",
          surface: { surface: "api" },
          idempotencyKey: req.idempotencyKey,
          targetHint: { deploymentId: payload.deploymentId },
          ...(req.parentWorkUnitId ? { parentWorkUnitId: req.parentWorkUnitId } : {}),
        });
        if (!response.ok) {
          return { ok: false };
        }
        return { ok: true, result: response.result };
      },
    },
    now: () => new Date(),
  });

  const submitChildWork = async (request: ChildWorkRequest): Promise<SubmitWorkResponse> => {
    const deployment = await resolveDeploymentForIntent(
      deploymentResolver,
      request.organizationId,
      request.intent,
    );
    return platformIngress.submit({
      organizationId: request.organizationId,
      actor: request.actor,
      intent: request.intent,
      parameters: request.parameters,
      targetHint: deployment
        ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
        : undefined,
      trigger: "internal",
      surface: { surface: "api" },
      parentWorkUnitId: request.parentWorkUnitId,
      idempotencyKey: request.idempotencyKey,
      priority: request.priority as "low" | "normal" | "high" | undefined,
    });
  };

  const services = { submitChildWork };

  const handlers = new Map<string, WorkflowHandler>([
    ["creative.job.submit", buildCreativeJobSubmitWorkflow(prismaClient)],
    ["creative.job.continue", buildCreativeJobDecisionWorkflow(prismaClient, "continue")],
    ["creative.job.stop", buildCreativeJobDecisionWorkflow(prismaClient, "stop")],
    ["lead.intake", buildLeadIntakeWorkflow(leadIntakeHandler)],
    ["meta.lead.intake", buildMetaLeadIntakeWorkflow({ prisma: prismaClient, instantFormAdapter })],
    ["meta.lead.greeting.send", buildMetaLeadGreetingWorkflow()],
    ["meta.lead.inquiry.record", buildMetaLeadRecordInquiryWorkflow(prismaClient)],
  ]);

  modeRegistry.register(new WorkflowMode({ handlers, services }));

  const workflowIntents: Array<{
    intent: string;
    workflowId: string;
    budgetClass: "cheap" | "standard" | "expensive";
    approvalPolicy: "none" | "threshold" | "always";
    allowedTriggers: Array<"api" | "chat" | "schedule" | "internal">;
  }> = [
    {
      intent: "creative.job.submit",
      workflowId: "creative.job.submit",
      budgetClass: "expensive",
      approvalPolicy: "threshold",
      allowedTriggers: ["api"],
    },
    {
      intent: "creative.job.continue",
      workflowId: "creative.job.continue",
      budgetClass: "standard",
      approvalPolicy: "threshold",
      allowedTriggers: ["api"],
    },
    {
      intent: "creative.job.stop",
      workflowId: "creative.job.stop",
      budgetClass: "standard",
      approvalPolicy: "threshold",
      allowedTriggers: ["api"],
    },
    {
      intent: "lead.intake",
      workflowId: "lead.intake",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["internal", "api"],
    },
    {
      intent: "meta.lead.intake",
      workflowId: "meta.lead.intake",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["internal", "api"],
    },
    {
      intent: "meta.lead.greeting.send",
      workflowId: "meta.lead.greeting.send",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["internal"],
    },
    {
      intent: "meta.lead.inquiry.record",
      workflowId: "meta.lead.inquiry.record",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["internal"],
    },
  ];

  for (const reg of workflowIntents) {
    intentRegistry.register({
      intent: reg.intent,
      defaultMode: "workflow",
      allowedModes: ["workflow"],
      executor: { mode: "workflow", workflowId: reg.workflowId },
      parameterSchema: {},
      mutationClass: "write",
      budgetClass: reg.budgetClass,
      approvalPolicy: reg.approvalPolicy,
      idempotent: false,
      allowedTriggers: reg.allowedTriggers,
      timeoutMs: 300_000,
      retryable: true,
    });
  }

  logger.info("Contained workflow mode registered");

  return { instantFormAdapter };
}
