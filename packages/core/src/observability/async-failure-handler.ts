import type { AsyncFailureEnvelope } from "@switchboard/schemas";

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
