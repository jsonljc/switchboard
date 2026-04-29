import type { AuditEntry } from "@switchboard/schemas";
import type { WorkTrace } from "./work-trace.js";
import { computeWorkTraceContentHash } from "./work-trace-hash.js";
import type { AuditLedger } from "../audit/ledger.js";

export type IntegrityVerdict =
  | { status: "ok" }
  | { status: "mismatch"; expected: string; actual: string }
  | { status: "missing_anchor"; expectedAtVersion: number }
  | { status: "skipped"; reason: "pre_migration" };

export interface IntegrityOverride {
  actorId: string;
  reason: string;
  overrideAt: string;
}

export class WorkTraceIntegrityError extends Error {
  constructor(
    public readonly verdict: IntegrityVerdict,
    public readonly workUnitId: string,
  ) {
    super(`WorkTrace integrity check failed for ${workUnitId}: ${verdict.status}`);
    this.name = "WorkTraceIntegrityError";
  }
}

export function getString(snapshot: Record<string, unknown>, key: string): string | undefined {
  const v = snapshot[key];
  return typeof v === "string" ? v : undefined;
}

export function getNumber(snapshot: Record<string, unknown>, key: string): number | undefined {
  const v = snapshot[key];
  return typeof v === "number" ? v : undefined;
}

export interface VerifyParams {
  trace: WorkTrace;
  rowContentHash: string | null;
  rowTraceVersion: number;
  rowRequestedAt: string;
  anchor: AuditEntry | null;
  cutoffAt: string;
}

export function verifyWorkTraceIntegrity(params: VerifyParams): IntegrityVerdict {
  const { trace, rowContentHash, rowTraceVersion, rowRequestedAt, anchor, cutoffAt } = params;

  if (rowContentHash === null) {
    if (rowRequestedAt < cutoffAt) {
      return { status: "skipped", reason: "pre_migration" };
    }
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  // Invariant: contentHash present but version <= 0 — never trust as ok.
  if (rowTraceVersion <= 0) {
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  const recomputed = computeWorkTraceContentHash(trace, rowTraceVersion);
  if (recomputed !== rowContentHash) {
    return { status: "mismatch", expected: rowContentHash, actual: recomputed };
  }

  if (!anchor) {
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  const anchorHash = getString(anchor.snapshot, "contentHash");
  const anchorVersion = getNumber(anchor.snapshot, "traceVersion");
  if (anchorHash !== rowContentHash || anchorVersion !== rowTraceVersion) {
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  return { status: "ok" };
}

export interface AssertParams {
  trace: WorkTrace;
  integrity: IntegrityVerdict;
  override?: IntegrityOverride;
  auditLedger?: AuditLedger;
}

export async function assertExecutionAdmissible(params: AssertParams): Promise<void> {
  const { trace, integrity, override, auditLedger } = params;
  if (integrity.status === "ok") return;

  if (!override) {
    throw new WorkTraceIntegrityError(integrity, trace.workUnitId);
  }
  if (!auditLedger) {
    throw new Error(
      "assertExecutionAdmissible: override path requires auditLedger to record decision",
    );
  }

  await auditLedger.record({
    eventType: "work_trace.integrity_override",
    actorType: "user",
    actorId: override.actorId,
    entityType: "work_trace",
    entityId: trace.workUnitId,
    riskCategory: "high",
    visibilityLevel: "admin",
    summary: `Integrity override (${integrity.status}) by ${override.actorId}: ${override.reason}`,
    organizationId: trace.organizationId,
    traceId: trace.traceId,
    snapshot: {
      workUnitId: trace.workUnitId,
      integrityStatus: integrity.status,
      reason: override.reason,
      overrideAt: override.overrideAt,
    },
  });
}
