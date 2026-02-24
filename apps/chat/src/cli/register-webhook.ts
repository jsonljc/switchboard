/**
 * Register Telegram webhook.
 * Usage: pnpm cli:register-webhook https://your-domain.com/webhook/telegram
 */
async function main(): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  const url = process.argv[2];

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN not set");
    process.exit(1);
  }
  if (!url || !url.startsWith("https://")) {
    console.error("Usage: pnpm cli:register-webhook <https://...>");
    process.exit(1);
  }

  const payload: Record<string, unknown> = { url };
  if (secret) payload["secret_token"] = secret;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = (await res.json()) as { ok: boolean; description?: string };
  if (!result.ok) {
    console.error("Failed:", result.description);
    process.exit(1);
  }
  console.log("Webhook registered:", url);
}

main();
