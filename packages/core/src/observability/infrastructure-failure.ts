import type { InfrastructureErrorType, InfrastructureFailureAlert } from "./operator-alerter.js";

export type { InfrastructureErrorType } from "./operator-alerter.js";

export type FailureClass = "infrastructure";

const MAX_STACK_LENGTH = 2000;

export interface InfrastructureFailureSnapshot {
  errorType: InfrastructureErrorType;
  failureClass: FailureClass;
  severity: "critical" | "warning";
  errorMessage: string;
  errorName?: string;
  errorStack?: string;
  intent?: string;
  traceId?: string;
  deploymentId?: string;
  organizationId?: string;
  retryable: boolean;
  occurredAt: string;
}

export interface BuildInfrastructureFailureInput {
  errorType: InfrastructureErrorType;
  error: unknown;
  workUnit?: {
    id: string;
    intent: string;
    traceId: string;
    organizationId: string;
    deployment?: { deploymentId: string };
  };
  retryable: boolean;
}

export interface InfrastructureFailureAuditParams {
  eventType: "action.failed";
  actorType: "system";
  actorId: "platform_ingress";
  entityType: "work_unit";
  entityId: string;
  riskCategory: "high";
  summary: string;
  snapshot: InfrastructureFailureSnapshot;
  organizationId?: string;
  traceId: string | null;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function extractErrorMetadata(err: unknown): { name?: string; stack?: string } {
  if (!(err instanceof Error)) return {};
  return {
    name: err.name,
    stack: err.stack?.slice(0, MAX_STACK_LENGTH),
  };
}

export function buildInfrastructureFailureAuditParams(input: BuildInfrastructureFailureInput): {
  ledgerParams: InfrastructureFailureAuditParams;
  alert: InfrastructureFailureAlert;
} {
  const occurredAt = new Date().toISOString();
  const errorMessage = extractErrorMessage(input.error);
  const { name: errorName, stack: errorStack } = extractErrorMetadata(input.error);
  const severity = "critical" as const;

  const snapshot: InfrastructureFailureSnapshot = {
    errorType: input.errorType,
    failureClass: "infrastructure",
    severity,
    errorMessage,
    retryable: input.retryable,
    occurredAt,
  };
  // errorName/errorStack only persisted to the audit snapshot, not the alert payload
  // (alerts stay small; forensics live in the ledger).
  if (errorName !== undefined) snapshot.errorName = errorName;
  if (errorStack !== undefined) snapshot.errorStack = errorStack;
  const alert: InfrastructureFailureAlert = {
    errorType: input.errorType,
    severity,
    errorMessage,
    retryable: input.retryable,
    occurredAt,
    source: "platform_ingress",
  };

  if (input.workUnit) {
    snapshot.intent = input.workUnit.intent;
    snapshot.traceId = input.workUnit.traceId;
    snapshot.organizationId = input.workUnit.organizationId;
    alert.intent = input.workUnit.intent;
    alert.traceId = input.workUnit.traceId;
    alert.organizationId = input.workUnit.organizationId;
    if (input.workUnit.deployment) {
      snapshot.deploymentId = input.workUnit.deployment.deploymentId;
      alert.deploymentId = input.workUnit.deployment.deploymentId;
    }
  }

  const ledgerParams: InfrastructureFailureAuditParams = {
    eventType: "action.failed",
    actorType: "system",
    actorId: "platform_ingress",
    entityType: "work_unit",
    entityId: input.workUnit?.id ?? "unknown",
    riskCategory: "high",
    summary: `Infrastructure failure: ${input.errorType}`,
    snapshot,
    organizationId: input.workUnit?.organizationId,
    traceId: input.workUnit?.traceId ?? null,
  };

  return { ledgerParams, alert };
}
