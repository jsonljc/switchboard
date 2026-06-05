import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import { hasSurfacedCreativeMemorySignal } from "@switchboard/core/skill-runtime";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { SURFACING_THRESHOLD, parseMiraComposeOutput } from "@switchboard/schemas";
import {
  isoWeekKey,
  type MiraBriefComposeSubmitInput,
  type MiraConceptDraftSubmitInput,
} from "../workflows/mira-self-brief-request.js";
import type { MiraComposeBrief } from "@switchboard/schemas";

// Local Inngest client. All function registrations in apps/api share the same
// switchboard id; they fan out to the single serve handler in bootstrap/inngest.ts.
const inngestClient = new Inngest({ id: "switchboard" });

/**
 * Desk hygiene cap (slice-4 spec 3.7): inFlight INCLUDES awaiting_review AND
 * in_progress, so Mira's own unacted concept rows count toward it; ignored
 * proposals throttle her by construction.
 */
export const SELF_BRIEF_BACKLOG_CAP = 5;

export const SELF_BRIEF_SCAN_EVENT = "mira/self-brief.scan";

// ── Dispatch ──

export interface MiraSelfBriefDispatchDeps {
  /** Distinct orgs with an ACTIVE creative deployment. */
  listCreativeOrgs: () => Promise<string[]>;
  /** Bound to inngestClient.send in apps/api. */
  sendEvent: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
}

interface DispatchStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeMiraSelfBriefDispatch(
  step: DispatchStepTools,
  deps: MiraSelfBriefDispatchDeps,
): Promise<{ dispatched: number }> {
  const orgs = await step.run("list-creative-orgs", () => deps.listCreativeOrgs());
  for (const organizationId of orgs) {
    await step.run(`emit-${organizationId}`, async () => {
      await deps.sendEvent({ name: SELF_BRIEF_SCAN_EVENT, data: { organizationId } });
    });
  }
  return { dispatched: orgs.length };
}

/**
 * Weekly dispatch cron, Mondays 10:00 UTC: after the daily 06:00 taste sweep,
 * the daily 06:30 attribution refresh, and the Monday 09:00 weekly Riley
 * audit, so the week's freshest signal is already persisted (spec 3.7).
 * Read-only; the per-org worker owns the kill-switch (the attribution
 * pattern: dispatch always fires, the worker short-circuits when dark).
 */
export function createMiraSelfBriefDispatch(
  deps: MiraSelfBriefDispatchDeps,
  onFailure?: (arg: unknown) => Promise<void>,
) {
  return inngestClient.createFunction(
    {
      id: "mira-self-brief-dispatch",
      name: "Mira Self-Brief Dispatch",
      retries: 2,
      triggers: [{ cron: "0 10 * * 1" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) => executeMiraSelfBriefDispatch(step as unknown as DispatchStepTools, deps),
  );
}

// ── Worker ──

export interface MiraSelfBriefWorkerDeps {
  /** Read per invocation: MIRA_SELF_BRIEF_ENABLED === "true". */
  readEnabledFlag: () => boolean;
  isMiraEnabled: (orgId: string) => Promise<boolean>;
  resolveCreativeDeployment: (
    orgId: string,
  ) => Promise<{ deploymentId: string; skillSlug: string } | null>;
  readModel: {
    read(
      orgId: string,
      opts: { now: Date; timezone: string },
    ): Promise<{
      jobs: Array<{ performance?: { delivery: string } }>;
      counts: { inFlight: number };
    }>;
  };
  memoryReader: {
    listHighConfidence(
      orgId: string,
      deploymentId: string,
      minConfidence: number,
      minSourceCount: number,
    ): Promise<
      Array<{
        id: string;
        category: string;
        canonicalKey: string | null;
        sourceCount: number;
        confidence: number;
      }>
    >;
  };
  submitCompose: (
    input: MiraBriefComposeSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse>;
  submitConceptDraft: (
    input: MiraConceptDraftSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse>;
  warn: (msg: string) => void;
  /** Optional clock for deterministic testing. */
  now?: () => Date;
}

export type MiraSelfBriefOutcome =
  | { skipped: string; detail?: string }
  | { abstained: string }
  | { jobId: string };

/**
 * Per-org weekly scan (spec 3.7): floor -> compose through ingress -> parse ->
 * draft-only concept child. Every submit is idempotency-keyed on the UTC ISO
 * week, so a retried run (inngest retries: 2) replays claims instead of
 * duplicating work, and at most ONE self-initiated draft exists per org per
 * week by construction. Every exit is a named outcome in the inngest run
 * history: "Mira chose quiet" and "Mira stopped parsing" are distinguishable.
 */
export async function executeMiraSelfBriefScan(
  deps: MiraSelfBriefWorkerDeps,
  organizationId: string,
): Promise<MiraSelfBriefOutcome> {
  if (!deps.readEnabledFlag()) return { skipped: "disabled" };
  if (!(await deps.isMiraEnabled(organizationId))) return { skipped: "mira_not_enabled" };
  const deployment = await deps.resolveCreativeDeployment(organizationId);
  if (!deployment) return { skipped: "no_creative_deployment" };

  const now = deps.now?.() ?? new Date();
  // Floor reads are tz-insensitive (status counts + measured presence): UTC.
  // The builder re-reads authoritatively with the org timezone at compose time.
  const model = await deps.readModel.read(organizationId, { now, timezone: "UTC" });
  if (model.counts.inFlight >= SELF_BRIEF_BACKLOG_CAP) return { skipped: "backlog_cap" };

  const hasMeasured = model.jobs.some((j) => j.performance?.delivery === "measured");
  if (!hasMeasured) {
    const memoryRows = await deps.memoryReader.listHighConfidence(
      organizationId,
      deployment.deploymentId,
      SURFACING_THRESHOLD.minConfidence,
      SURFACING_THRESHOLD.minSourceCount,
    );
    if (!hasSurfacedCreativeMemorySignal(memoryRows)) return { skipped: "no_signal" };
  }

  const week = isoWeekKey(now);
  const composeResponse = await deps.submitCompose(
    {
      organizationId,
      composeSource: "weekly_scan",
      idempotencyKey: `self-brief-compose:${deployment.deploymentId}:${week}`,
    },
    deployment,
  );

  const composed = classifyComposeResponse(composeResponse, organizationId, deps.warn);
  if (!("brief" in composed)) return composed;

  const draftResponse = await deps.submitConceptDraft(
    {
      organizationId,
      brief: composed.brief,
      parentWorkUnitId: composed.parentWorkUnitId,
      idempotencyKey: `self-brief:${deployment.deploymentId}:${week}`,
    },
    deployment,
  );

  return classifyDraftResponse(draftResponse, organizationId, deps.warn);
}

/**
 * Compose-response classifier: every non-propose path is a NAMED outcome;
 * propose yields the brief + the parent work unit id for trace linkage.
 */
function classifyComposeResponse(
  response: SubmitWorkResponse,
  organizationId: string,
  warn: (msg: string) => void,
): MiraSelfBriefOutcome | { brief: MiraComposeBrief; parentWorkUnitId: string } {
  if (!response.ok) {
    const type = response.error.type;
    // Fails fast pre-LLM (spec fact 31): the named skip keeps "Mira is silent
    // because the org is unentitled" operator-visible, never swallowed.
    if (type === "entitlement_required") return { skipped: "org_not_entitled" };
    // A prior crashed attempt left a running claim (spec fact 32); the weekly
    // key self-heals next ISO week.
    if (type === "idempotency_in_flight") return { skipped: "compose_claim_unresolved" };
    warn(`[mira-self-brief] compose submit failed for ${organizationId}: ${type}`);
    return { skipped: "compose_submit_failed", detail: type };
  }
  if ("approvalRequired" in response && response.approvalRequired) {
    // A future org policy may park compose; a parked compose must never
    // phantom-draft (the pending_approval gotcha).
    warn(`[mira-self-brief] compose parked for ${organizationId}; no draft will be created`);
    return { skipped: "compose_parked" };
  }
  if (response.result.outcome !== "completed") {
    warn(`[mira-self-brief] compose outcome ${response.result.outcome} for ${organizationId}`);
    return { skipped: "compose_failed", detail: response.result.outcome };
  }

  const responseText = (response.result.outputs as { response?: unknown }).response;
  const parsed =
    typeof responseText === "string"
      ? parseMiraComposeOutput(responseText)
      : ({ ok: false, error: "no response output" } as const);
  if (!parsed.ok) {
    warn(
      `[mira-self-brief] compose parse failure for ${organizationId}: ${parsed.error}; head: ` +
        `${typeof responseText === "string" ? responseText.slice(0, 200) : "<none>"}`,
    );
    return { skipped: "compose_parse_failure" };
  }
  if (parsed.value.decision === "abstain") return { abstained: parsed.value.reason };
  return { brief: parsed.value.brief!, parentWorkUnitId: response.workUnit.id };
}

/** Draft-response classifier: a created jobId is the ONLY success shape. */
function classifyDraftResponse(
  response: SubmitWorkResponse,
  organizationId: string,
  warn: (msg: string) => void,
): MiraSelfBriefOutcome {
  if (!response.ok) {
    if (response.error.type === "idempotency_in_flight") {
      return { skipped: "draft_claim_unresolved" };
    }
    warn(`[mira-self-brief] draft submit failed for ${organizationId}: ${response.error.type}`);
    return { skipped: "draft_submit_failed", detail: response.error.type };
  }
  if ("approvalRequired" in response && response.approvalRequired) {
    warn(`[mira-self-brief] draft unexpectedly parked for ${organizationId}`);
    return { skipped: "draft_parked" };
  }
  const outcome = response.result.outcome;
  if (outcome !== "completed" && outcome !== "queued") {
    warn(`[mira-self-brief] draft outcome ${outcome} for ${organizationId}`);
    return { skipped: "draft_failed", detail: outcome };
  }
  // A "completed" child is not necessarily a created draft (the workflow
  // returns skipped:true without a jobId when Mira is org-disabled). Require
  // the jobId so the scan never reports a phantom draft.
  const outputs = response.result.outputs as { jobId?: unknown; reason?: unknown };
  const jobId = typeof outputs?.jobId === "string" ? outputs.jobId : null;
  if (!jobId) {
    return { skipped: typeof outputs?.reason === "string" ? outputs.reason : "draft_no_job" };
  }
  return { jobId };
}

const MIRA_SELF_BRIEF_WORKER_FAILURE_PARAMS = {
  functionId: "mira-self-brief-worker",
  eventDomain: "mira.self_brief",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

/**
 * Per-org scan worker. Triggered by SELF_BRIEF_SCAN_EVENT from the weekly
 * dispatch. Class-E failure contract (audit always, no domain event): the
 * next weekly run self-heals and a mira.self_brief.failed event would have
 * zero consumers. No internal step.run: every submit is idempotency-keyed, so
 * a whole-function retry replays claims instead of duplicating work.
 */
export function createMiraSelfBriefWorker(
  deps: MiraSelfBriefWorkerDeps & { failure: AsyncFailureContext },
) {
  return inngestClient.createFunction(
    {
      id: "mira-self-brief-worker",
      name: "Mira Self-Brief Worker",
      retries: 2,
      triggers: [{ event: SELF_BRIEF_SCAN_EVENT }],
      onFailure: makeOnFailureHandler(MIRA_SELF_BRIEF_WORKER_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async ({ event }) =>
      executeMiraSelfBriefScan(deps, (event.data as { organizationId: string }).organizationId),
  );
}
