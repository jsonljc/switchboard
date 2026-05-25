import type { AsyncFailureEnvelope, RiskCategory } from "@switchboard/schemas";
import type { AuditLedger } from "../audit/ledger.js";
import type { OperatorAlerter } from "./operator-alerter.js";

const DEFAULT_FAILURE_CODE = "ASYNC_JOB_FAILED";

export interface BuildAsyncFailureInput {
  functionId: string;
  eventName: string;
  attempts: number;
  retryable: boolean;
  error: unknown;
  occurredAt: string;
  stage?: string;
  runId?: string;
  organizationId?: string;
  deploymentId?: string;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function codeOf(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return DEFAULT_FAILURE_CODE;
}

/** Build the canonical async-failure envelope (spec §1). Message is the raw
 *  error text; callers are responsible for not throwing secrets into errors. */
export function buildAsyncFailureEnvelope(input: BuildAsyncFailureInput): AsyncFailureEnvelope {
  return {
    code: codeOf(input.error),
    message: messageOf(input.error),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    functionId: input.functionId,
    eventName: input.eventName,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    attempts: input.attempts,
    retryable: input.retryable,
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.deploymentId !== undefined ? { deploymentId: input.deploymentId } : {}),
    occurredAt: input.occurredAt,
  };
}

/** Minimal Inngest client surface the handler needs (avoids a hard SDK type dep). */
export interface AsyncEventSender {
  send(event: { name: string; data: Record<string, unknown> }): Promise<unknown>;
}

export interface AsyncFailureContext {
  auditLedger: AuditLedger;
  operatorAlerter: OperatorAlerter;
  inngest: AsyncEventSender;
}

export interface OnFailureParams {
  functionId: string;
  /** Domain prefix for the `<domain>.failed` event; omit with emitEvent:false for Class E. */
  eventDomain?: string;
  riskCategory: RiskCategory;
  /** Class A/D-critical → true: fire OperatorAlerter. */
  alert: boolean;
  /** Class A–D → true (default); Class E with no consumer → false. */
  emitEvent?: boolean;
  /** Alert severity when alert:true. Default "critical". */
  severity?: "critical" | "warning";
}

// Verified Inngest v4.2.4 onFailure arg (FailureEventArgs): the ORIGINAL trigger is at
// arg.event.data.event; the run id is arg.event.data.run_id; arg.error is the thrown Error.
interface InngestOnFailureArg {
  error: unknown;
  event?: { data?: { run_id?: string; event?: { name?: string } } };
}

/** Build a standard onFailure handler (spec §2). Never throws — failure handling
 *  must not itself crash the function-failed pipeline. */
export function makeOnFailureHandler(params: OnFailureParams, ctx: AsyncFailureContext) {
  const emitEvent = params.emitEvent ?? true;
  return async (arg: InngestOnFailureArg): Promise<void> => {
    const occurredAt = new Date().toISOString();
    const runId = arg.event?.data?.run_id;
    const eventName = arg.event?.data?.event?.name ?? params.functionId;
    const envelope = buildAsyncFailureEnvelope({
      functionId: params.functionId,
      eventName,
      attempts: 0, // Inngest does not surface attempt count in onFailure; 0 = "exhausted".
      retryable: !(arg.error instanceof Error && arg.error.name === "NonRetriableError"),
      error: arg.error,
      occurredAt,
      ...(runId !== undefined ? { runId } : {}),
    });

    // (a) ALWAYS — canonical audit record (spec §2a).
    try {
      await ctx.auditLedger.record({
        eventType: "infrastructure.job.retry_exhausted",
        actorType: "system",
        actorId: params.functionId,
        entityType: "async_job",
        entityId:
          envelope.runId ?? `${envelope.functionId}:${envelope.eventName}:${envelope.occurredAt}`,
        riskCategory: params.riskCategory,
        summary: `async job ${params.functionId} exhausted retries: ${envelope.code}`,
        snapshot: envelope as unknown as Record<string, unknown>,
        ...(envelope.organizationId !== undefined
          ? { organizationId: envelope.organizationId }
          : {}),
      });
    } catch (err) {
      console.error(`[async-failure] audit record failed for ${params.functionId}`, err);
    }

    // (b) dead-letter destination — domain event (spec §2b; optional for Class E).
    if (emitEvent && params.eventDomain) {
      try {
        await ctx.inngest.send({
          name: `${params.eventDomain}.failed`,
          data: envelope as unknown as Record<string, unknown>,
        });
      } catch (err) {
        console.error(`[async-failure] .failed emit failed for ${params.functionId}`, err);
      }
    }

    // (c) alert classes only (spec §2c).
    if (params.alert) {
      try {
        await ctx.operatorAlerter.alert({
          errorType: "async_job_retry_exhausted",
          severity: params.severity ?? "critical",
          errorMessage: `${params.functionId}: ${envelope.message}`,
          retryable: envelope.retryable,
          occurredAt,
          source: "inngest_function",
          ...(envelope.organizationId !== undefined
            ? { organizationId: envelope.organizationId }
            : {}),
          ...(envelope.deploymentId !== undefined ? { deploymentId: envelope.deploymentId } : {}),
        });
      } catch (err) {
        console.error(`[async-failure] operator alert failed for ${params.functionId}`, err);
      }
    }
  };
}
