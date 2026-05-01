/**
 * Lightweight runtime validator for the JSON-Schema-shaped `inputSchema`
 * objects declared on `SkillToolOperation`. Defense-in-depth alongside the
 * factory-with-context pattern: even if a tool field slips through, the
 * schema check prevents unexpected fields from reaching `execute()`.
 *
 * Supports the subset actually used by tools:
 *   - `type: "object"` with `properties` and `required`
 *   - per-property `type` checks for `string` | `number` | `boolean` | `object` | `array`
 *   - `enum` constraint
 *
 * Anything outside that subset is allowed through (lenient by design — the
 * JSON-schema subset evolves and this guard is non-canonical).
 */

export interface InputSchemaValidationFailure {
  ok: false;
  issues: string[];
}

export interface InputSchemaValidationSuccess {
  ok: true;
}

export type InputSchemaValidationResult =
  | InputSchemaValidationSuccess
  | InputSchemaValidationFailure;

interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
}

interface ObjectJsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true; // unknown declared type — allow through
  }
}

function checkRequired(required: string[], input: Record<string, unknown>, issues: string[]): void {
  for (const field of required) {
    if (!(field in input) || input[field] === undefined) {
      issues.push(`missing required field: ${field}`);
    }
  }
}

function checkProperty(
  field: string,
  declared: JsonSchemaProperty,
  value: unknown,
  issues: string[],
): void {
  if (declared.type && !checkType(value, declared.type)) {
    issues.push(`field "${field}" expected type ${declared.type}`);
  }
  if (Array.isArray(declared.enum) && !declared.enum.includes(value)) {
    issues.push(`field "${field}" must be one of: ${declared.enum.join(", ")}`);
  }
}

export function validateToolInput(
  schema: Record<string, unknown> | undefined,
  input: unknown,
): InputSchemaValidationResult {
  if (!schema || typeof schema !== "object") return { ok: true };

  const obj = schema as ObjectJsonSchema;
  if (obj.type && obj.type !== "object") return { ok: true };

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: ["input must be an object"] };
  }

  const issues: string[] = [];
  const inputRecord = input as Record<string, unknown>;

  if (Array.isArray(obj.required)) {
    checkRequired(obj.required, inputRecord, issues);
  }

  if (obj.properties && typeof obj.properties === "object") {
    for (const [field, declared] of Object.entries(obj.properties)) {
      if (!(field in inputRecord)) continue;
      if (declared && typeof declared === "object") {
        checkProperty(field, declared, inputRecord[field], issues);
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/**
 * Produce a redacted summary of LLM-supplied input for logging. Field names
 * are preserved but values are reduced to type tags so secrets / PII leaked
 * into the input by a prompt injection don't get persisted to logs.
 */
export function redactInputForLog(input: unknown): string {
  if (input === null) return "null";
  if (typeof input !== "object" || Array.isArray(input)) return `<${typeof input}>`;
  const record = input as Record<string, unknown>;
  const summarized: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === null) {
      summarized.push(`${key}=null`);
      continue;
    }
    if (Array.isArray(value)) {
      summarized.push(`${key}=<array:${value.length}>`);
      continue;
    }
    summarized.push(`${key}=<${typeof value}>`);
  }
  return `{${summarized.join(",")}}`;
}
