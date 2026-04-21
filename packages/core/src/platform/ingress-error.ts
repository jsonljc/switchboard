export interface IngressError {
  type: "intent_not_found" | "validation_failed" | "trigger_not_allowed" | "deployment_not_found";
  intent: string;
  message: string;
}

export function isIngressError(value: unknown): value is IngressError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "intent" in value &&
    "message" in value
  );
}
