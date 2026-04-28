export type HealthTransition = "failure" | "recovery";

export interface HealthAlertContext {
  channel: string;
  channelId: string;
  statusDetail?: string | null;
}

const TIMEOUT_MS = 5000;

function buildText(transition: HealthTransition, ctx: HealthAlertContext): string {
  if (transition === "failure") {
    const detail = ctx.statusDetail ?? "unknown";
    return `🚨 Chat health check failed: ${ctx.channel}/${ctx.channelId} — ${detail}`;
  }
  return `✅ Chat health recovered: ${ctx.channel}/${ctx.channelId}`;
}

export async function sendHealthCheckAlert(
  transition: HealthTransition,
  ctx: HealthAlertContext,
): Promise<void> {
  const url = process.env["ALERT_WEBHOOK_URL"];
  if (!url) return;

  const body = JSON.stringify({ text: buildText(transition, ctx) });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("[alert-webhook] failed:", response.status, response.statusText);
    }
  } catch (err) {
    console.error("[alert-webhook] error:", err);
  }
}
