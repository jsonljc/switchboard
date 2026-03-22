import { AgentCheckpointSchema } from "@switchboard/schemas";
import type { AgentCheckpoint } from "@switchboard/schemas";
import type { z } from "@switchboard/schemas";

const MAX_CHECKPOINT_BYTES = 500 * 1024; // 500KB

type ValidationSuccess = { valid: true; checkpoint: AgentCheckpoint };
type ValidationFailure = { valid: false; errors: string[] };
type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate checkpoint structure against the base schema and optional size limit.
 * Switchboard never interprets checkpoint contents semantically — this is
 * purely structural validation.
 */
export function validateCheckpoint(
  value: unknown,
  roleSchema?: z.ZodType<AgentCheckpoint>,
): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: false, errors: ["Checkpoint cannot be null or undefined"] };
  }

  // Size check first (cheap, avoids parsing huge payloads)
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_CHECKPOINT_BYTES) {
    return {
      valid: false,
      errors: [
        `Checkpoint size ${serialized.length} bytes exceeds maximum ${MAX_CHECKPOINT_BYTES} bytes`,
      ],
    };
  }

  // Structural validation against base schema
  const schema = roleSchema ?? AgentCheckpointSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return { valid: true, checkpoint: parsed.data };
}
