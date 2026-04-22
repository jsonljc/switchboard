import type { ExecutableWorkUnit } from "@switchboard/schemas";
import type { LifecycleRecord } from "./lifecycle-types.js";

export type AdmissionErrorCode =
  | "LIFECYCLE_NOT_APPROVED"
  | "STALE_AUTHORITY"
  | "EXPIRED_WORK_UNIT"
  | "LINEAGE_MISMATCH";

export class DispatchAdmissionError extends Error {
  readonly code: AdmissionErrorCode;

  constructor(code: AdmissionErrorCode, message: string) {
    super(message);
    this.name = "DispatchAdmissionError";
    this.code = code;
  }
}

export function validateDispatchAdmission(
  lifecycle: LifecycleRecord,
  workUnit: ExecutableWorkUnit,
  now?: Date,
): void {
  if (lifecycle.status !== "approved") {
    throw new DispatchAdmissionError(
      "LIFECYCLE_NOT_APPROVED",
      `Lifecycle ${lifecycle.id} status is "${lifecycle.status}", expected "approved"`,
    );
  }

  if (workUnit.lifecycleId !== lifecycle.id) {
    throw new DispatchAdmissionError(
      "LINEAGE_MISMATCH",
      `Work unit ${workUnit.id} belongs to lifecycle ${workUnit.lifecycleId}, not ${lifecycle.id}`,
    );
  }

  if (lifecycle.currentExecutableWorkUnitId !== workUnit.id) {
    throw new DispatchAdmissionError(
      "STALE_AUTHORITY",
      `Work unit ${workUnit.id} is not the current executable for lifecycle ${lifecycle.id} (current: ${lifecycle.currentExecutableWorkUnitId})`,
    );
  }

  const checkTime = now ?? new Date();
  if (checkTime > workUnit.executableUntil) {
    throw new DispatchAdmissionError(
      "EXPIRED_WORK_UNIT",
      `Work unit ${workUnit.id} expired at ${workUnit.executableUntil.toISOString()}`,
    );
  }
}
