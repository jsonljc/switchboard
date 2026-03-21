import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export const MAX_BATCH_SIZE = 50;
export const MAX_AMOUNT_DOLLARS = 999_999;

export function validateAmount(
  value: unknown,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): string | null {
  if (typeof value !== "number" || isNaN(value)) return "amount must be a number";
  if (!allowNegative && value <= 0) return "amount must be positive";
  if (value === 0) return "amount must be non-zero";
  if (Math.abs(value) > MAX_AMOUNT_DOLLARS)
    return `amount exceeds maximum of $${MAX_AMOUNT_DOLLARS}`;
  return null;
}

export function amountError(start: number, msg: string): ExecuteResult {
  return {
    success: false,
    summary: msg,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step: "validate", error: msg }],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}

export function missingParamResult(start: number, paramName: string): ExecuteResult {
  return {
    success: false,
    summary: `Missing required parameter: ${paramName}`,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step: "validate", error: `${paramName} is required` }],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}
