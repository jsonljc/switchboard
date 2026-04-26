let sentryInitialized = false;

export async function initChatSentry(): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) return;

  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    serverName: "switchboard-chat",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
  sentryInitialized = true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryInitialized) return;
  import("@sentry/node")
    .then((Sentry) => {
      Sentry.captureException(err, { extra: context });
    })
    .catch(() => {
      // Sentry capture failed — don't break the request
    });
}

export function isSentryInitialized(): boolean {
  return sentryInitialized;
}
