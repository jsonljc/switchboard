// ---------------------------------------------------------------------------
// Shared Payload Validation Utility
// ---------------------------------------------------------------------------

/**
 * Thrown when an event payload fails validation against a declared schema.
 */
export class PayloadValidationError extends Error {
  constructor(
    public readonly agentId: string | undefined,
    public readonly missingFields: string[],
    public readonly wrongTypeFields: string[],
  ) {
    const prefix = agentId ? `[${agentId}] ` : "";
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`missing required fields: ${missingFields.join(", ")}`);
    }
    if (wrongTypeFields.length > 0) {
      parts.push(`wrong type fields: ${wrongTypeFields.join(", ")}`);
    }
    super(`${prefix}Invalid event payload: ${parts.join("; ")}`);
    this.name = "PayloadValidationError";
  }
}

type FieldType = "string" | "number" | "boolean" | "string?" | "number?" | "boolean?";

/**
 * Validates that `payload` is a non-null object and that every field declared
 * in `schema` is present with the correct type.  Fields whose type ends with
 * `?` are optional — they are allowed to be absent but must have the correct
 * type when present.
 *
 * @returns The payload cast to `Record<string, unknown>`.
 * @throws {PayloadValidationError} when validation fails.
 */
export function validatePayload(
  payload: unknown,
  schema: Record<string, FieldType>,
  agentId?: string,
): Record<string, unknown> {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    throw new PayloadValidationError(
      agentId,
      Object.keys(schema).filter((k) => !schema[k]!.endsWith("?")),
      [],
    );
  }

  const record = payload as Record<string, unknown>;
  const missingFields: string[] = [];
  const wrongTypeFields: string[] = [];

  for (const [field, fieldType] of Object.entries(schema)) {
    const optional = fieldType.endsWith("?");
    const baseType = optional ? fieldType.slice(0, -1) : fieldType;
    const value = record[field];

    if (value === undefined || value === null) {
      if (!optional) {
        missingFields.push(field);
      }
      continue;
    }

    if (typeof value !== baseType) {
      wrongTypeFields.push(field);
    }
  }

  if (missingFields.length > 0 || wrongTypeFields.length > 0) {
    throw new PayloadValidationError(agentId, missingFields, wrongTypeFields);
  }

  return record;
}
