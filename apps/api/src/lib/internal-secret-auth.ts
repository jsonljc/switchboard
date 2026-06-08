import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type InternalSecretCheck = "ok" | "unconfigured" | "unauthorized";

/**
 * Verify a request's `Authorization: Bearer <INTERNAL_API_SECRET>` header against the
 * configured `INTERNAL_API_SECRET`, using a timing-safe comparison. Returns the check
 * state; callers map it to an HTTP response (401/503) per their own fail-closed policy.
 *
 * Compare BYTE lengths (not UTF-16 code units): a multi-byte header with a matching
 * code-unit count would otherwise make timingSafeEqual throw a RangeError and surface
 * as a 500 instead of a 401. Shared by the chat-approval bridge and the chat-to-API
 * ingress route (F-15) so the security primitive stays identical in every place.
 */
export function verifyInternalSecret(request: FastifyRequest): InternalSecretCheck {
  const secret = process.env["INTERNAL_API_SECRET"];
  if (!secret) return "unconfigured";
  const header = request.headers.authorization;
  if (!header) return "unauthorized";
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (headerBuf.length !== expectedBuf.length) return "unauthorized";
  if (!timingSafeEqual(headerBuf, expectedBuf)) return "unauthorized";
  return "ok";
}
