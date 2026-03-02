/**
 * Resolve dot-path template expressions from event payloads.
 *
 * Template syntax:
 *   "$event.payload.path.to.value" → resolved from DomainEvent
 *   "$event.principalId" → resolved from DomainEvent top-level fields
 *
 * Non-template values (not starting with "$") are passed through as-is.
 */
export function resolveTemplate(
  template: Record<string, unknown>,
  event: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(template)) {
    result[key] = resolveValue(value, event);
  }

  return result;
}

function resolveValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$event.")) {
    const path = value.slice("$event.".length);
    return getNestedValue(context, path);
  }

  if (typeof value === "string" && value.includes("$event.")) {
    // String interpolation: "Treatment: $event.payload.treatmentType"
    return value.replace(/\$event\.([a-zA-Z0-9_.]+)/g, (_match, path: string) => {
      const resolved = getNestedValue(context, path);
      return resolved !== undefined ? String(resolved) : "";
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context));
  }

  if (value !== null && typeof value === "object") {
    return resolveTemplate(value as Record<string, unknown>, context);
  }

  return value;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
