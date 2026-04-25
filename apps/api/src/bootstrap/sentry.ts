// ---------------------------------------------------------------------------
// Sentry error monitoring — initializes Sentry SDK and wires Fastify error handler
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";

let sentryInitialized = false;

/**
 * Initialize Sentry SDK. No-op if SENTRY_DSN is not set.
 * Must be called early in the bootstrap sequence (before routes).
 */
export async function initSentry(): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) return;

  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
  sentryInitialized = true;
}

/**
 * Wire Sentry error capture into Fastify's error handler.
 * Wraps the existing error handler so Sentry captures 5xx errors
 * without changing the response format.
 */
export function wireSentryErrorHandler(app: FastifyInstance): void {
  if (!sentryInitialized) return;

  const originalHandler = app.errorHandler;

  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) {
      try {
        const Sentry = await import("@sentry/node");
        Sentry.captureException(error, {
          extra: {
            url: request.url,
            method: request.method,
            traceId: request.traceId,
          },
        });
      } catch {
        // Sentry capture failed — don't break the request
      }
    }

    return originalHandler(error, request, reply);
  });
}
