import { NotFoundError, NeedsClarificationError } from "@switchboard/core";

const SAFE_ERROR_NAMES = new Set([
  "NotFoundError",
  "NeedsClarificationError",
  "ZodError",
  "ValidationError",
]);

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Extracts a user-safe error message. Only known safe error types have their
 * messages forwarded; everything else (DB failures, credential issues, etc.)
 * gets a generic message to prevent internal detail leakage.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof NotFoundError) return err.explanation;
  if (err instanceof NeedsClarificationError) return err.question;

  if (err instanceof Error && SAFE_ERROR_NAMES.has(err.name)) {
    return err.message;
  }

  return GENERIC_MESSAGE;
}
