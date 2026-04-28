type IngressErrorTypeBase =
  | "intent_not_found"
  | "validation_failed"
  | "trigger_not_allowed"
  | "deployment_not_found"
  | "upstream_error"
  | "network_error";

export type IngressError =
  | {
      type: IngressErrorTypeBase;
      intent: string;
      message: string;
      retryable?: boolean;
    }
  | {
      type: "entitlement_required";
      intent: string;
      message: string;
      retryable?: boolean;
      blockedStatus: string;
    };

export function isIngressError(value: unknown): value is IngressError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "intent" in value &&
    "message" in value
  );
}
