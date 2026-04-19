export interface ToolResult {
  status: "success" | "error" | "denied" | "pending_approval";
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable: boolean;
  };
  entityState?: Record<string, unknown>;
  nextActions?: string[];
}

export function ok(
  data?: Record<string, unknown>,
  opts?: { entityState?: Record<string, unknown>; nextActions?: string[] },
): ToolResult {
  return {
    status: "success",
    data,
    entityState: opts?.entityState,
    nextActions: opts?.nextActions,
  };
}

export function fail(
  code: string,
  message: string,
  opts?: {
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable?: boolean;
    data?: Record<string, unknown>;
  },
): ToolResult {
  return {
    status: "error",
    data: opts?.data,
    error: {
      code,
      message,
      modelRemediation: opts?.modelRemediation,
      operatorRemediation: opts?.operatorRemediation,
      retryable: opts?.retryable ?? false,
    },
  };
}

export function denied(message: string, modelRemediation?: string): ToolResult {
  return {
    status: "denied",
    error: {
      code: "DENIED_BY_POLICY",
      message,
      modelRemediation,
      retryable: false,
    },
  };
}

export function pendingApproval(message: string): ToolResult {
  return {
    status: "pending_approval",
    error: {
      code: "APPROVAL_REQUIRED",
      message,
      retryable: false,
    },
  };
}
