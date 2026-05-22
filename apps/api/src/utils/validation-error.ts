import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

/**
 * Emits the canonical validation-failure envelope per Route Governance
 * Contract v1 §4.3. Replaces the current mix of
 * `{ details: error.format() }`, `{ issues: error.issues.map(...) }`, and
 * `{ details: error.issues }` across routes.
 *
 * The envelope intentionally returns raw `ZodIssue[]` (not formatted /
 * stringified): clients parse `code`, `path`, and `message` directly off the
 * issue array.
 */
export function replyValidationError(reply: FastifyReply, error: ZodError): FastifyReply {
  return reply.code(400).send({
    error: "invalid_body",
    issues: error.issues,
    statusCode: 400,
  });
}
