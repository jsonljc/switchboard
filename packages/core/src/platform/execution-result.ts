import type { ExecutionModeName, WorkOutcome, ExecutionError } from "./types.js";

export interface ExecutionResult {
  workUnitId: string;
  outcome: WorkOutcome;
  summary: string;
  outputs: Record<string, unknown>;
  mode: ExecutionModeName;
  durationMs: number;
  traceId: string;
  approvalId?: string;
  jobId?: string;
  error?: ExecutionError;
}
