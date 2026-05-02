import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Installs the global Fastify error handler.
 *
 * Behavior:
 * - 5xx: in production, `error` is scrubbed to "Internal server error" (no
 *   leaking of DB query strings, file paths, stack traces). In development,
 *   the original `error.message` and `error.stack` are passed through so the
 *   dashboard banner and DevTools surface the real cause.
 * - 4xx: `error.message` is always passed through (client error, no scrub).
 *
 * The full error object is always written server-side via `app.log.error`.
 *
 * Production gate: this handler treats `process.env.NODE_ENV === "production"`
 * as production, matching the convention used elsewhere in this app (CORS,
 * logger pretty-print, billing entitlement enforcement). Staging or preview
 * deployments MUST set `NODE_ENV=production` to keep stack traces from
 * leaking in 5xx responses.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const isProd = process.env.NODE_ENV === "production";

    if (statusCode >= 500) {
      app.log.error(error);
    }

    const message =
      statusCode >= 500
        ? isProd
          ? "Internal server error"
          : (error.message ?? "Internal server error")
        : error.message;

    const body: { error: string; statusCode: number; stack?: string } = {
      error: message,
      statusCode,
    };
    if (statusCode >= 500 && !isProd && error.stack) {
      body.stack = error.stack;
    }

    return reply.code(statusCode).send(body);
  });
}
