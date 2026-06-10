import { ERROR_CATEGORIES, DEFAULT_REMEDIATIONS } from "./error-taxonomy.js";
import type { ErrorCategory } from "./error-taxonomy.js";
import type { PendingApprovalPayload } from "@switchboard/schemas";

export interface ToolResult {
  status: "success" | "error" | "denied" | "pending_approval";
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable: boolean;
    /**
     * Typed payload for pending_approval results. Carries the kind
     * classification + presentation hints (body/quote/quoteFrom) that the
     * dashboard's rich approval adapter reads to render the correct card
     * variant. Absent on legacy approvals (pre-A.7c).
     */
    payload?: PendingApprovalPayload;
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

interface FailOpts {
  modelRemediation?: string;
  operatorRemediation?: string;
  retryable?: boolean;
  data?: Record<string, unknown>;
}

export function fail(code: string, message: string, opts?: FailOpts): ToolResult;
export function fail(
  category: ErrorCategory,
  code: string,
  message: string,
  opts?: FailOpts,
): ToolResult;
export function fail(
  categoryOrCode: string,
  codeOrMessage: string,
  messageOrOpts?: string | FailOpts,
  opts?: FailOpts,
): ToolResult {
  const isCategory = (ERROR_CATEGORIES as readonly string[]).includes(categoryOrCode);

  if (isCategory && typeof messageOrOpts === "string") {
    // Category-aware form: fail(category, code, message, opts?)
    const code = codeOrMessage;
    const message = messageOrOpts;
    const defaults = DEFAULT_REMEDIATIONS[code];
    return {
      status: "error",
      data: opts?.data,
      error: {
        code,
        message,
        modelRemediation: opts?.modelRemediation ?? defaults?.modelRemediation,
        operatorRemediation: opts?.operatorRemediation ?? defaults?.operatorRemediation,
        retryable: opts?.retryable ?? defaults?.retryable ?? false,
      },
    };
  }

  // Legacy form: fail(code, message, opts?)
  const code = categoryOrCode;
  const message = codeOrMessage;
  const legacyOpts = messageOrOpts as FailOpts | undefined;
  return {
    status: "error",
    data: legacyOpts?.data,
    error: {
      code,
      message,
      modelRemediation: legacyOpts?.modelRemediation,
      operatorRemediation: legacyOpts?.operatorRemediation,
      retryable: legacyOpts?.retryable ?? false,
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

export function pendingApproval(message: string, payload?: PendingApprovalPayload): ToolResult {
  return {
    status: "pending_approval",
    error: {
      code: "APPROVAL_REQUIRED",
      message,
      retryable: false,
      // The in-skill governance hook short-circuits before the tool executes
      // and cannot (yet) park the call into a resumable lifecycle, so this
      // result is re-injected to the model. Be explicit that nothing happened,
      // so the model never reports a non-executed action as done (audit F2).
      modelRemediation:
        "This action has NOT been completed; it is awaiting human approval. Do not tell the customer it succeeded or was booked. Acknowledge honestly that the team will confirm it shortly, or escalate so a person can complete it.",
      ...(payload ? { payload } : {}),
    },
  };
}
