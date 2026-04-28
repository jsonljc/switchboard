export type InfrastructureErrorType = "governance_eval_exception" | "trace_persist_failed";

export interface InfrastructureFailureAlert {
  errorType: InfrastructureErrorType;
  severity: "critical" | "warning";
  errorMessage: string;
  intent?: string;
  traceId?: string;
  deploymentId?: string;
  organizationId?: string;
  retryable: boolean;
  occurredAt: string;
  source: "platform_ingress";
}

export interface OperatorAlerter {
  alert(payload: InfrastructureFailureAlert): Promise<void>;
}

export class NoopOperatorAlerter implements OperatorAlerter {
  async alert(_payload: InfrastructureFailureAlert): Promise<void> {
    // intentional no-op
  }
}
