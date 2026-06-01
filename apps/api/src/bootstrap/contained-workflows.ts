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

/**
 * Builds the governed child-work submitter: resolves the child's deployment by
 * intent and submits through PlatformIngress with trigger:"internal". Shared by
 * the contained-workflow services AND the SkillMode delegate tool so both use the
 * one front door (no parallel mutation paths).
 */
export function createSubmitChildWork(deps: {
  platformIngress: PlatformIngress;
  deploymentResolver: DeploymentResolver | null;
}): (request: ChildWorkRequest) => Promise<SubmitWorkResponse> {
  return async (request: ChildWorkRequest): Promise<SubmitWorkResponse> => {
    const deployment = await resolveDeploymentForIntent(
      deps.deploymentResolver,
      request.organizationId,
      request.intent,
    );
    return deps.platformIngress.submit({
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
  const { buildCreativeConceptDraftWorkflow } =
    await import("../services/workflows/creative-concept-draft-workflow.js");
  const { buildCreativeJobDecisionWorkflow } =
    await import("../services/workflows/creative-job-decision-workflow.js");
  const { buildMetaLeadIntakeWorkflow } =
    await import("../services/workflows/meta-lead-intake-workflow.js");
  const { buildMetaLeadGreetingWorkflow } =
    await import("../services/workflows/meta-lead-greeting-workflow.js");
  const { buildConversationFollowUpSendWorkflow } =
    await import("../services/workflows/conversation-followup-send-workflow.js");
  const { buildMetaLeadRecordInquiryWorkflow } =
    await import("../services/workflows/meta-lead-record-inquiry-workflow.js");
  const { LeadIntakeHandler, buildLeadIntakeWorkflow } = await import("@switchboard/core");
  const {
    PrismaLeadIntakeStore,
    PrismaAgentTaskStore,
    PrismaCreativeJobStore,
    PrismaDeploymentStore,
    PrismaOrgAgentEnablementStore,
  } = await import("@switchboard/db");
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

  const submitChildWork = createSubmitChildWork({ platformIngress, deploymentResolver });

  const services = { submitChildWork };

  // Alex→Mira delegation target: draft-only creative concept (no pipeline / no spend).
  const creativeConceptDraftWorkflow = buildCreativeConceptDraftWorkflow({
    taskStore: new PrismaAgentTaskStore(
      prismaClient as ConstructorParameters<typeof PrismaAgentTaskStore>[0],
    ),
    jobStore: new PrismaCreativeJobStore(
      prismaClient as ConstructorParameters<typeof PrismaCreativeJobStore>[0],
    ),
    deploymentStore: new PrismaDeploymentStore(
      prismaClient as ConstructorParameters<typeof PrismaDeploymentStore>[0],
    ),
    enablementStore: new PrismaOrgAgentEnablementStore(
      prismaClient as ConstructorParameters<typeof PrismaOrgAgentEnablementStore>[0],
    ),
  });

  const followUpSendHandler = buildConversationFollowUpSendWorkflow({
    getSendContext: async (orgId, contactId, threadId) => {
      const prisma = prismaClient as import("@switchboard/db").PrismaClient;
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, organizationId: orgId },
        select: {
          name: true,
          phone: true,
          messagingOptIn: true,
          pdpaJurisdiction: true,
          consentGrantedAt: true,
          consentRevokedAt: true,
        },
      });
      const org = await prisma.organizationConfig.findUnique({
        where: { id: orgId },
        select: { name: true },
      });
      const thread =
        threadId !== null
          ? await prisma.conversationThread.findUnique({
              where: { id: threadId },
              select: { lastWhatsAppInboundAt: true },
            })
          : null;
      return {
        consentGrantedAt: contact?.consentGrantedAt ?? null,
        consentRevokedAt: contact?.consentRevokedAt ?? null,
        pdpaJurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
        messagingOptIn: contact?.messagingOptIn ?? false,
        lastWhatsAppInboundAt: thread?.lastWhatsAppInboundAt ?? null,
        jurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
        leadName: contact?.name ?? "there",
        businessName: org?.name ?? "our clinic",
        phone: contact?.phone ?? null,
      };
    },
    allowMarketingTemplate: process.env["FOLLOWUP_ALLOW_MARKETING_TEMPLATE"] === "true",
  });

  const handlers = new Map<string, WorkflowHandler>([
    ["creative.job.submit", buildCreativeJobSubmitWorkflow(prismaClient)],
    ["creative.concept.draft", creativeConceptDraftWorkflow],
    ["creative.job.continue", buildCreativeJobDecisionWorkflow(prismaClient, "continue")],
    ["creative.job.stop", buildCreativeJobDecisionWorkflow(prismaClient, "stop")],
    ["lead.intake", buildLeadIntakeWorkflow(leadIntakeHandler)],
    ["meta.lead.intake", buildMetaLeadIntakeWorkflow({ prisma: prismaClient, instantFormAdapter })],
    ["meta.lead.greeting.send", buildMetaLeadGreetingWorkflow()],
    ["meta.lead.inquiry.record", buildMetaLeadRecordInquiryWorkflow(prismaClient)],
    ["conversation.followup.send", followUpSendHandler],
  ]);

  modeRegistry.register(new WorkflowMode({ handlers, services }));

  const workflowIntents: Array<{
    intent: string;
    workflowId: string;
    budgetClass: "cheap" | "standard" | "expensive";
    approvalPolicy: "none" | "threshold" | "always";
    approvalMode?: "system_auto_approved";
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
      // Alex→Mira draft-only handoff. No spend (the handler never fires the
      // creative pipeline), reversible (just a CreativeJob draft row), and
      // internal-trigger-only (not reachable from the public API).
      // approvalMode:"system_auto_approved" short-circuits the policy/approval
      // step BEFORE identity resolution: an agent-actor child has no seeded
      // IdentitySpec, so without this the child would hard-deny with
      // GOVERNANCE_ERROR — and there is nothing for the compliance floor to catch
      // on a no-outbound draft. It STILL flows through ingress (entitlement,
      // idempotency, WorkTrace, audit, dispatch). Spend-bearing targets must NOT
      // copy this — they keep approvalPolicy:"threshold" and park for approval.
      intent: "creative.concept.draft",
      workflowId: "creative.concept.draft",
      budgetClass: "cheap",
      approvalPolicy: "none",
      approvalMode: "system_auto_approved",
      allowedTriggers: ["internal"],
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
    {
      intent: "conversation.followup.send",
      workflowId: "conversation.followup.send",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["schedule"],
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
      approvalMode: reg.approvalMode,
      idempotent: false,
      allowedTriggers: reg.allowedTriggers,
      timeoutMs: 300_000,
      retryable: true,
    });
  }

  logger.info("Contained workflow mode registered");

  return { instantFormAdapter };
}
