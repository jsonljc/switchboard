/* eslint-disable max-lines */
// This central workflow-registration orchestrator grows by one block per governed intent; it was
// already extracted once (riley-pause-executor.ts) and sits at the 600-line gate. Registering the
// Spec-1B reallocate intent crossed it, so the line cap is acknowledged here as legacy debt
// (arch-check.ts treats this marker as 🟡, matching app.ts / inngest.ts / skill-mode.ts). A future
// split of the workflowIntents registry into a data module is the real fix.
import type {
  ExecutionModeRegistry,
  WorkflowHandler,
  DeploymentResolver,
  WorkTraceStore,
} from "@switchboard/core/platform";
import { WorkflowMode } from "@switchboard/core/platform";
import type { IntentRegistry } from "@switchboard/core/platform";
import type { PlatformIngress, SubmitWorkResponse } from "@switchboard/core/platform";
import type { ChildWorkRequest } from "@switchboard/core/platform";
import type { InstantFormAdapter } from "@switchboard/ad-optimizer";
import { resolveDeploymentForIntent } from "../utils/resolve-deployment.js";
import { buildFollowUpSendSubmitRequest } from "../services/workflows/followup-send-request.js";
import { buildLeadIntakeIngressSubmitRequest } from "../services/workflows/lead-intake-request.js";
import type { FollowUpSendSubmitInput } from "../services/cron/scheduled-follow-up-dispatch.js";
import { buildReminderSendSubmitRequest } from "../services/workflows/reminder-send-request.js";
import type { ReminderSendSubmitInput } from "../services/workflows/reminder-send-request.js";
import {
  buildRecommendationHandoffSubmitRequest,
  type RecommendationHandoffSubmitInput,
} from "../services/workflows/recommendation-handoff-request.js";
import {
  buildRileyPauseSubmitRequest,
  type RileyPauseSubmitInput,
} from "../services/workflows/riley-pause-submit-request.js";
import {
  buildMiraBriefComposeSubmitRequest,
  buildMiraConceptDraftSubmitRequest,
  type MiraBriefComposeSubmitInput,
  type MiraConceptDraftSubmitInput,
} from "../services/workflows/mira-self-brief-request.js";

interface ContainedWorkflowBootstrapDeps {
  prismaClient: unknown;
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  platformIngress: PlatformIngress;
  deploymentResolver: DeploymentResolver | null;
  /** WorkTrace reader backing the pause executor's required last-mile approved-
   * lifecycle check (D5-2a); always wired so the executor reads an approved trace. */
  workTraceStore: Pick<WorkTraceStore, "getByWorkUnitId">;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export interface ContainedWorkflowBootstrapResult {
  /**
   * The single InstantFormAdapter instance shared across all IF Contact-creation
   * paths (workflow + lead-retry cron). Cron deps must reuse this instance to
   * preserve the "no parallel mutation paths" doctrine.
   */
  instantFormAdapter: InstantFormAdapter;
  /**
   * Top-level submit closure for the scheduled-follow-up dispatch cron. No
   * parentWorkUnitId — cron-initiated work units are legitimate trace roots.
   * Resolves the conversation deployment by intent and submits through
   * PlatformIngress with trigger:"schedule".
   */
  submitScheduledFollowUp: (input: FollowUpSendSubmitInput) => Promise<SubmitWorkResponse>;
  /**
   * Top-level submit closure for the appointment-reminder dispatch cron. No
   * parentWorkUnitId — cron-initiated work units are legitimate trace roots.
   * Resolves the conversation deployment by intent and submits through
   * PlatformIngress with trigger:"schedule".
   */
  submitScheduledReminder: (input: ReminderSendSubmitInput) => Promise<SubmitWorkResponse>;
  /**
   * Top-level submit closure for the Riley weekly-audit cron's agent handoff
   * (Contract 3). Builds the canonical request (or returns null when Riley abstains)
   * and submits through PlatformIngress with the resolved Riley deployment as the
   * targetHint, parking for mandatory human approval via the seeded policy. No
   * parentWorkUnitId — cron-initiated work units are legitimate trace roots.
   */
  submitRecommendationHandoff: (
    input: RecommendationHandoffSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
  /**
   * Top-level submit closure for the Phase-C pause initiator. Builds the canonical
   * request (or returns null when Riley abstains: class/floor legs in the builder)
   * and submits through PlatformIngress with the resolved Riley deployment as the
   * targetHint, parking for mandatory human approval via the seeded policy. No
   * parentWorkUnitId - cron-initiated work units are legitimate trace roots.
   */
  submitRileyPause: (
    input: RileyPauseSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
  /**
   * Top-level submit closures for the slice-4 mira brain. Compose is the
   * read-class reasoning work unit; concept-draft is the draft-only child the
   * weekly scan creates from a propose verdict. Both resolve the org's
   * creative deployment by intent prefix when the caller has not already
   * resolved it, and both carry the seeded system principal. The scan worker
   * passes the deployment it resolved at floor time; the PR-4 handoff
   * enrichment path lets the closure resolve it.
   */
  submitMiraBriefCompose: (
    input: MiraBriefComposeSubmitInput,
    deployment?: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse>;
  submitMiraConceptDraft: (
    input: MiraConceptDraftSubmitInput,
    deployment?: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse>;
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
    workTraceStore,
    logger,
  } = deps;

  const { buildCreativeJobSubmitWorkflow } =
    await import("../services/workflows/creative-job-submit-workflow.js");
  const { buildCreativeConceptDraftWorkflow } =
    await import("../services/workflows/creative-concept-draft-workflow.js");
  const { buildRecommendationHandoffWorkflow } =
    await import("../services/workflows/recommendation-handoff-workflow.js");
  const { buildCreativeJobDecisionWorkflow } =
    await import("../services/workflows/creative-job-decision-workflow.js");
  const { buildMetaLeadIntakeWorkflow } =
    await import("../services/workflows/meta-lead-intake-workflow.js");
  const { buildMetaLeadGreetingWorkflow } =
    await import("../services/workflows/meta-lead-greeting-workflow.js");
  const { buildConversationFollowUpSendWorkflow } =
    await import("../services/workflows/conversation-followup-send-workflow.js");
  const { buildConversationReminderSendWorkflow } =
    await import("../services/workflows/conversation-reminder-send-workflow.js");
  const { buildMetaLeadRecordInquiryWorkflow } =
    await import("../services/workflows/meta-lead-record-inquiry-workflow.js");
  const { buildCreativePublishWorkflow } =
    await import("../services/workflows/creative-publish-workflow.js");
  const { buildRileyPauseExecutorHandler } = await import("./riley-pause-executor.js");
  const { buildRileyBudgetExecutorHandler } = await import("./riley-budget-executor.js");
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
        // Seeded `system` principal (not a bespoke system:* id) so governance can
        // resolve the actor's IdentitySpec — see lead-intake-request.ts.
        const response = await platformIngress.submit(buildLeadIntakeIngressSubmitRequest(req));
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

  // Riley→agent advisory handoff (Contract 3): on approval, routes a Riley creative
  // recommendation to a draft-only creative.concept.draft child. Stateless handler
  // (it submits the child through `services.submitChildWork`).
  const recommendationHandoffWorkflow = buildRecommendationHandoffWorkflow();

  // Phase-C pause executor: on approval, pauses the campaign on Meta with the
  // org's own meta-ads credentials. Wiring (incl. the org-isolation credential
  // resolver) lives in bootstrap/riley-pause-executor.ts.
  const rileyPauseExecutor = await buildRileyPauseExecutorHandler(prismaClient, workTraceStore);

  // Spec-1B 1B-1.5b: the governed reallocate intent is registered + seeded (allow +
  // require_approval(mandatory)) so an approved reallocation parks; the EXECUTOR is now the real
  // read-modify-re-read handler (approval + content-binding check, replay-first, frozen-account
  // lock, drift check, signed-delta blast-radius cap, durable marker committed before the Meta
  // write, post-write re-read, ExecutionReceipt). The sink that initiates a reallocation stays
  // flag-gated and unwired until 1B-1.6, so this executes only operator-approved reallocations.
  const rileyBudgetExecutor = await buildRileyBudgetExecutorHandler(prismaClient, workTraceStore);

  // Shared assembly for both proactive-send contexts (follow-up + reminder). The ONLY
  // difference between callers is how the WhatsApp 24h-window timestamp is resolved
  // (follow-up: by threadId; reminder: by the contactId+org compound key), so each caller
  // looks that up and passes it in.
  type WhatsAppSendContext = {
    consentGrantedAt: Date | string | null;
    consentRevokedAt: Date | string | null;
    pdpaJurisdiction: "SG" | "MY" | null;
    messagingOptIn: boolean;
    lastWhatsAppInboundAt: Date | null;
    jurisdiction: "SG" | "MY" | null;
    leadName: string;
    businessName: string;
    phone: string | null;
  };
  const buildWhatsAppSendContext = async (
    prisma: import("@switchboard/db").PrismaClient,
    orgId: string,
    contactId: string,
    lastWhatsAppInboundAt: Date | null,
  ): Promise<WhatsAppSendContext> => {
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
    return {
      consentGrantedAt: contact?.consentGrantedAt ?? null,
      consentRevokedAt: contact?.consentRevokedAt ?? null,
      pdpaJurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
      messagingOptIn: contact?.messagingOptIn ?? false,
      lastWhatsAppInboundAt,
      jurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
      leadName: contact?.name ?? "there",
      businessName: org?.name ?? "our clinic",
      phone: contact?.phone ?? null,
    };
  };

  const followUpSendHandler = buildConversationFollowUpSendWorkflow({
    getSendContext: async (orgId, contactId, threadId) => {
      const prisma = prismaClient as import("@switchboard/db").PrismaClient;
      const thread =
        threadId !== null
          ? await prisma.conversationThread.findUnique({
              where: { id: threadId },
              select: { lastWhatsAppInboundAt: true },
            })
          : null;
      return buildWhatsAppSendContext(
        prisma,
        orgId,
        contactId,
        thread?.lastWhatsAppInboundAt ?? null,
      );
    },
    allowMarketingTemplate: process.env["FOLLOWUP_ALLOW_MARKETING_TEMPLATE"] === "true",
  });

  const reminderSendHandler = buildConversationReminderSendWorkflow({
    getSendContext: async (orgId, contactId) => {
      const prisma = prismaClient as import("@switchboard/db").PrismaClient;
      const thread = await prisma.conversationThread.findUnique({
        where: { contactId_organizationId: { contactId, organizationId: orgId } },
        select: { lastWhatsAppInboundAt: true },
      });
      return buildWhatsAppSendContext(
        prisma,
        orgId,
        contactId,
        thread?.lastWhatsAppInboundAt ?? null,
      );
    },
    allowMarketingTemplate: false,
  });

  // creative.job.publish: a thin dispatcher. It validates ownership, short-circuits an
  // already-parked job, then hands the rate-limited Meta chain to the dead-lettered
  // `creative-publish` Inngest function (deps wired in bootstrap/inngest.ts). The handler
  // needs only the job store for the lookup + short-circuit.
  const creativePublishWorkflow = buildCreativePublishWorkflow({
    jobStore: new PrismaCreativeJobStore(
      prismaClient as ConstructorParameters<typeof PrismaCreativeJobStore>[0],
    ),
  });

  const handlers = new Map<string, WorkflowHandler>([
    ["creative.job.submit", buildCreativeJobSubmitWorkflow(prismaClient)],
    ["creative.concept.draft", creativeConceptDraftWorkflow],
    ["adoptimizer.recommendation.handoff", recommendationHandoffWorkflow],
    [rileyPauseExecutor.intent, rileyPauseExecutor.handler],
    [rileyBudgetExecutor.intent, rileyBudgetExecutor.handler],
    ["creative.job.continue", buildCreativeJobDecisionWorkflow(prismaClient, "continue")],
    ["creative.job.stop", buildCreativeJobDecisionWorkflow(prismaClient, "stop")],
    ["creative.job.publish", creativePublishWorkflow],
    ["lead.intake", buildLeadIntakeWorkflow(leadIntakeHandler)],
    ["meta.lead.intake", buildMetaLeadIntakeWorkflow({ prisma: prismaClient, instantFormAdapter })],
    ["meta.lead.greeting.send", buildMetaLeadGreetingWorkflow()],
    ["meta.lead.inquiry.record", buildMetaLeadRecordInquiryWorkflow(prismaClient)],
    ["conversation.followup.send", followUpSendHandler],
    ["conversation.reminder.send", reminderSendHandler],
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
      // Publish a kept creative as a self-contained PAUSED Meta draft package.
      // approvalPolicy is DECORATIVE (the policy engine never reads it) — the real
      // claim-safety gate is the seeded org-scoped require_approval(mandatory)
      // policy for `creative.job.publish` (see db seed creative-governance.ts). We
      // keep "always" here only as documented intent + the safe value if anything
      // ever reads it. Spend-bearing/publish targets do NOT use
      // system_auto_approved (that is the draft-only handoff below).
      intent: "creative.job.publish",
      workflowId: "creative.job.publish",
      budgetClass: "standard",
      approvalPolicy: "always",
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
      // Riley→agent advisory handoff (Contract 3). A Riley-initiated (system) edge
      // that can lead to creative spend (it creates a Mira draft a human later
      // funds), so it is deliberately NOT system_auto_approved — the seeded
      // require_approval(mandatory) policy (db seed recommendation-handoff-
      // governance.ts) parks it for a human. approvalPolicy here is decorative (the
      // policy engine reads policyApprovalOverride, not this). Internal-trigger-only
      // (not reachable from the public API).
      intent: "adoptimizer.recommendation.handoff",
      workflowId: "adoptimizer.recommendation.handoff",
      budgetClass: "cheap",
      approvalPolicy: "always",
      allowedTriggers: ["internal"],
    },
    {
      // Phase-C pause self-execution (Riley v3 slice-5 seam, wired). A
      // Riley-initiated (system) ad mutation: deliberately NOT
      // system_auto_approved - the seeded require_approval(mandatory) policy
      // (db seed riley-pause-governance.ts) parks it for a human, and
      // "mandatory" survives the autonomous-deployment spend lever.
      // approvalPolicy here is decorative (the policy engine reads
      // policyApprovalOverride). parameterSchema stays {} because the field is
      // decorative platform-wide (zero non-test consumers); real containment is
      // the typed builder + internal-only trigger + the executor's fail-closed
      // Zod parse. Internal-trigger-only (not reachable from the public API).
      intent: rileyPauseExecutor.intent,
      workflowId: rileyPauseExecutor.intent,
      budgetClass: "cheap",
      approvalPolicy: "always",
      allowedTriggers: ["internal"],
    },
    {
      // Spec-1B budget reallocation self-execution. A Riley-initiated (system) MONEY MOVE:
      // deliberately NOT system_auto_approved (it is also on the D9-2 FINANCIAL_AUTO_APPROVE_DENYLIST,
      // governance-gate.ts) - the seeded require_approval(mandatory) policy (db seed
      // riley-budget-governance.ts) parks it for a human, and "mandatory" survives the
      // autonomous-deployment spend lever. approvalPolicy here is decorative (the policy engine reads
      // policyApprovalOverride). The executor is a fail-closed placeholder (EXECUTOR_NOT_WIRED) until
      // the real read-modify-re-read executor lands in PR 1B-1.5. Internal-trigger-only.
      intent: rileyBudgetExecutor.intent,
      workflowId: rileyBudgetExecutor.intent,
      budgetClass: "cheap",
      approvalPolicy: "always",
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
    {
      intent: "conversation.reminder.send",
      workflowId: "conversation.reminder.send",
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

  const submitScheduledFollowUp = async (
    input: FollowUpSendSubmitInput,
  ): Promise<SubmitWorkResponse> => {
    const deployment = await resolveDeploymentForIntent(
      deploymentResolver,
      input.organizationId,
      "conversation.followup.send",
    );
    return platformIngress.submit(buildFollowUpSendSubmitRequest(input, deployment));
  };

  const submitScheduledReminder = async (
    input: ReminderSendSubmitInput,
  ): Promise<SubmitWorkResponse> => {
    const deployment = await resolveDeploymentForIntent(
      deploymentResolver,
      input.organizationId,
      "conversation.reminder.send",
    );
    return platformIngress.submit(buildReminderSendSubmitRequest(input, deployment));
  };

  // Riley → agent recommendation handoff (Contract 3). The deployment is resolved by
  // the cron itself (it iterates the org's active ad-optimizer deployments and passes
  // {deploymentId, skillSlug:"ad-optimizer"}), so the top-level resolver's intent-prefix
  // slug derivation ("adoptimizer" ≠ seeded "ad-optimizer") never bites here.
  const submitRecommendationHandoff = async (
    input: RecommendationHandoffSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ): Promise<SubmitWorkResponse | null> => {
    const req = buildRecommendationHandoffSubmitRequest(input, deployment);
    // null ⇒ Riley abstained (evidence floor / learning lockout / unroutable). Do not
    // submit — the builder owns this first-line abstention; the handler re-checks.
    if (!req) return null;
    return platformIngress.submit(req);
  };

  // Phase-C pause initiator. Deployment resolution mirrors the handoff: the cron
  // iterates Riley's active ad-optimizer deployments and passes
  // {deploymentId, skillSlug:"ad-optimizer"}; never the intent-prefix fallback.
  const submitRileyPause = async (
    input: RileyPauseSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ): Promise<SubmitWorkResponse | null> => {
    const req = buildRileyPauseSubmitRequest(input, deployment);
    // null ⇒ Riley abstained (class eligibility / recommendation floor / raised
    // execution floor). Do not submit — the builder owns this first-line
    // abstention; the executor re-checks as defense in depth.
    if (!req) return null;
    return platformIngress.submit(req);
  };

  const submitMiraBriefCompose = async (
    input: MiraBriefComposeSubmitInput,
    deployment?: { deploymentId: string; skillSlug: string },
  ): Promise<SubmitWorkResponse> => {
    const resolved =
      deployment ??
      (await resolveDeploymentForIntent(
        deploymentResolver,
        input.organizationId,
        "creative.brief.compose",
      ));
    return platformIngress.submit(buildMiraBriefComposeSubmitRequest(input, resolved));
  };

  const submitMiraConceptDraft = async (
    input: MiraConceptDraftSubmitInput,
    deployment?: { deploymentId: string; skillSlug: string },
  ): Promise<SubmitWorkResponse> => {
    const resolved =
      deployment ??
      (await resolveDeploymentForIntent(
        deploymentResolver,
        input.organizationId,
        "creative.concept.draft",
      ));
    return platformIngress.submit(buildMiraConceptDraftSubmitRequest(input, resolved));
  };

  return {
    instantFormAdapter,
    submitScheduledFollowUp,
    submitScheduledReminder,
    submitRecommendationHandoff,
    submitRileyPause,
    submitMiraBriefCompose,
    submitMiraConceptDraft,
  };
}
