import type { ZodSchema, ZodError } from "zod";

/**
 * Safely parse cartridge action parameters using a Zod schema.
 *
 * Replaces unsafe `parameters["key"] as string` patterns that silently
 * produce `"undefined"` when a key is missing. Instead, this validates
 * the parameters at runtime and throws a descriptive error on mismatch.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { parseParams } from "@switchboard/cartridge-sdk";
 *
 * const UpdateBudgetParams = z.object({
 *   campaignId: z.string(),
 *   newBudget: z.number().positive(),
 *   currency: z.string().default("USD"),
 * });
 *
 * async execute(actionType: string, parameters: Record<string, unknown>) {
 *   const { campaignId, newBudget, currency } = parseParams(UpdateBudgetParams, parameters);
 *   // campaignId is guaranteed to be a string, newBudget a positive number
 * }
 * ```
 */
export function parseParams<T>(schema: ZodSchema<T>, params: Record<string, unknown>): T {
  const result = schema.safeParse(params);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new ParamValidationError(`Invalid action parameters:\n${issues}`, result.error);
}

/**
 * Error thrown when cartridge action parameters fail Zod validation.
 */
export class ParamValidationError extends Error {
  readonly zodError: ZodError;

  constructor(message: string, zodError: ZodError) {
    super(message);
    this.name = "ParamValidationError";
    this.zodError = zodError;
  }
}
