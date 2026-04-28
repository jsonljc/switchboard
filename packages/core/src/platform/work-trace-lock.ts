import type { WorkTrace } from "./work-trace.js";
import type { WorkOutcome } from "./types.js";

export const TERMINAL_OUTCOMES: ReadonlySet<WorkOutcome> = new Set(["completed", "failed"]);

export const ALLOWED_OUTCOME_TRANSITIONS: Readonly<Record<WorkOutcome, ReadonlySet<WorkOutcome>>> =
  {
    pending_approval: new Set<WorkOutcome>(["queued", "running", "completed", "failed"]),
    queued: new Set<WorkOutcome>(["running", "completed", "failed"]),
    running: new Set<WorkOutcome>(["completed", "failed"]),
    completed: new Set<WorkOutcome>(),
    failed: new Set<WorkOutcome>(),
  };

const ALWAYS_IMMUTABLE_FIELDS: ReadonlySet<keyof WorkTrace> = new Set([
  "workUnitId",
  "traceId",
  "parentWorkUnitId",
  "deploymentId",
  "intent",
  "mode",
  "organizationId",
  "actor",
  "trigger",
  "idempotencyKey",
  "deploymentContext",
  "governanceOutcome",
  "governanceConstraints",
  "riskScore",
  "matchedPolicies",
  "requestedAt",
  "governanceCompletedAt",
]);

const ONE_SHOT_FIELDS: ReadonlySet<keyof WorkTrace> = new Set([
  "approvalId",
  "approvalOutcome",
  "approvalRespondedBy",
  "approvalRespondedAt",
  "executionStartedAt",
]);

export interface WorkTraceLockDiagnostic {
  traceId: string;
  workUnitId: string;
  currentOutcome: WorkOutcome;
  lockedAt: string | null;
  rejectedFields: string[];
  reason: string;
  caller?: string;
}

export class WorkTraceLockedError extends Error {
  readonly code = "WORK_TRACE_LOCKED" as const;
  readonly diagnostic: WorkTraceLockDiagnostic;

  constructor(diagnostic: WorkTraceLockDiagnostic) {
    super(diagnostic.reason);
    this.name = "WorkTraceLockedError";
    this.diagnostic = diagnostic;
  }
}

export type ValidateUpdateResult =
  | { ok: true; computedLockedAt: string | null }
  | { ok: false; diagnostic: WorkTraceLockDiagnostic };

export function validateUpdate(args: {
  current: WorkTrace;
  update: Partial<WorkTrace>;
  caller?: string;
  now?: () => Date;
}): ValidateUpdateResult {
  const { current, update, caller } = args;
  const nowFn = args.now ?? (() => new Date());
  const rejectedFields: string[] = [];

  const isLocked = current.lockedAt !== undefined && current.lockedAt !== null;

  // Locked: blanket-reject any field write that differs from existing.
  if (isLocked) {
    for (const key of Object.keys(update) as Array<keyof WorkTrace>) {
      const incoming = update[key];
      const existing = current[key];
      if (!isEqual(incoming, existing)) rejectedFields.push(String(key));
    }
    if (rejectedFields.length > 0) {
      return rejection({
        current,
        rejectedFields,
        reason: `Trace locked at ${current.lockedAt}; further mutation forbidden`,
        caller,
      });
    }
    return { ok: true, computedLockedAt: current.lockedAt ?? null };
  }

  // Outcome transition check
  if (update.outcome !== undefined && update.outcome !== current.outcome) {
    const allowed = ALLOWED_OUTCOME_TRANSITIONS[current.outcome];
    if (!allowed.has(update.outcome)) {
      rejectedFields.push("outcome");
    }
  }

  // Always-immutable fields
  for (const key of ALWAYS_IMMUTABLE_FIELDS) {
    if (key in update) {
      const incoming = (update as Record<string, unknown>)[key as string];
      const existing = (current as unknown as Record<string, unknown>)[key as string];
      if (!isEqual(incoming, existing)) rejectedFields.push(String(key));
    }
  }

  // Bucket B: parameters mutable until approvalOutcome OR executionStartedAt set.
  if (update.parameters !== undefined && !isEqual(update.parameters, current.parameters)) {
    const sealed =
      current.approvalOutcome !== undefined || current.executionStartedAt !== undefined;
    if (sealed) rejectedFields.push("parameters");
  }

  // One-shot fields
  for (const key of ONE_SHOT_FIELDS) {
    if (!(key in update)) continue;
    const incoming = (update as Record<string, unknown>)[key as string];
    if (incoming === undefined) continue;
    const existing = (current as unknown as Record<string, unknown>)[key as string];
    if (existing !== undefined && existing !== null && !isEqual(incoming, existing)) {
      rejectedFields.push(String(key));
    }
  }

  if (rejectedFields.length > 0) {
    return rejection({
      current,
      rejectedFields,
      reason: `Forbidden WorkTrace mutation: rejected ${rejectedFields.join(", ")}`,
      caller,
    });
  }

  // Compute lockedAt if entering terminal.
  const enteringTerminal =
    update.outcome !== undefined &&
    TERMINAL_OUTCOMES.has(update.outcome) &&
    !TERMINAL_OUTCOMES.has(current.outcome);
  const computedLockedAt = enteringTerminal ? nowFn().toISOString() : null;
  return { ok: true, computedLockedAt };
}

function rejection(args: {
  current: WorkTrace;
  rejectedFields: string[];
  reason: string;
  caller?: string;
}): { ok: false; diagnostic: WorkTraceLockDiagnostic } {
  return {
    ok: false,
    diagnostic: {
      traceId: args.current.traceId,
      workUnitId: args.current.workUnitId,
      currentOutcome: args.current.outcome,
      lockedAt: args.current.lockedAt ?? null,
      rejectedFields: args.rejectedFields,
      reason: args.reason,
      caller: args.caller,
    },
  };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
