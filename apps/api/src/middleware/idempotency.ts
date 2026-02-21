import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";

// In-memory store for dev; in production, use Redis
const idempotencyStore = new Map<string, { response: unknown; expiresAt: number }>();

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const idempotencyMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return;

    const cached = idempotencyStore.get(idempotencyKey);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.code(200).send(cached.response);
    }
  });

  app.addHook("onSend", async (request, _reply, payload) => {
    if (request.method !== "POST") return payload;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return payload;

    idempotencyStore.set(idempotencyKey, {
      response: payload,
      expiresAt: Date.now() + WINDOW_MS,
    });

    return payload;
  });
};

export function computeIdempotencyKey(
  principalId: string,
  actionType: string,
  parameters: Record<string, unknown>,
): string {
  const windowBucket = Math.floor(Date.now() / WINDOW_MS);
  const input = JSON.stringify({ principalId, actionType, parameters, windowBucket });
  return createHash("sha256").update(input).digest("hex");
}
