// ---------------------------------------------------------------------------
// Startup Checks — validate required config before server boot
// ---------------------------------------------------------------------------

interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate required environment variables before the chat server starts.
 * Fails fast with clear error messages if critical config is missing.
 */
export function runStartupChecks(): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Core infrastructure
  if (!process.env["DATABASE_URL"]) {
    warnings.push("DATABASE_URL is not set — running without database (in-memory only)");
  }

  if (!process.env["REDIS_URL"]) {
    warnings.push("REDIS_URL is not set — dedup and session store will use in-memory fallbacks");
  }

  // Require at least one channel token (downgraded to a warning in development
  // so `pnpm dev` works on a fresh clone without third-party tokens configured)
  const hasTelegram = !!process.env["TELEGRAM_BOT_TOKEN"];
  const hasWhatsApp = !!process.env["WHATSAPP_TOKEN"] && !!process.env["WHATSAPP_PHONE_NUMBER_ID"];
  const hasSlack = !!process.env["SLACK_BOT_TOKEN"];

  if (!hasTelegram && !hasWhatsApp && !hasSlack) {
    const message =
      "No channel configured: TELEGRAM_BOT_TOKEN, WHATSAPP_TOKEN+WHATSAPP_PHONE_NUMBER_ID, or SLACK_BOT_TOKEN";
    if (process.env.NODE_ENV === "production") {
      errors.push(message);
    } else {
      warnings.push(`${message} — chat server will start with no inbound channels`);
    }
  }

  // Credential encryption key in production
  if (
    process.env.NODE_ENV === "production" &&
    process.env["DATABASE_URL"] &&
    !process.env["CREDENTIALS_ENCRYPTION_KEY"]
  ) {
    errors.push("CREDENTIALS_ENCRYPTION_KEY is required in production when DATABASE_URL is set");
  }

  // F-15: managed-channel mode (DATABASE_URL set) routes every inbound through the
  // chat-to-API ingress hop, which authenticates with INTERNAL_API_SECRET. Without it,
  // every inbound 401s silently. Fail fast and loud in all environments.
  if (process.env["DATABASE_URL"] && !process.env["INTERNAL_API_SECRET"]) {
    errors.push(
      "INTERNAL_API_SECRET is required when DATABASE_URL is set (managed-channel mode): " +
        "it authenticates the chat-to-API ingress hop. Set the same value on the api service.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
