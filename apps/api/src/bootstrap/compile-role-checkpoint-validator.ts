import Ajv, { type ValidateFunction } from "ajv";
import type { AgentCheckpoint } from "@switchboard/schemas";
import type {
  CheckpointValidationResult,
  RoleCheckpointValidator,
} from "@switchboard/core/sessions";

/**
 * Compile a role's checkpoint JSON Schema (manifest) into a validator.
 */
export function compileRoleCheckpointValidator(
  jsonSchema: unknown,
): RoleCheckpointValidator | undefined {
  if (jsonSchema === null || jsonSchema === undefined) return undefined;
  if (typeof jsonSchema !== "object") return undefined;

  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(jsonSchema as object);
  } catch {
    return undefined;
  }

  return (value: unknown): CheckpointValidationResult => {
    const ok = validate(value);
    if (ok) {
      return { valid: true, checkpoint: value as AgentCheckpoint };
    }
    const errors = validate.errors?.map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    ) ?? ["JSON Schema validation failed"];
    return { valid: false, errors };
  };
}
