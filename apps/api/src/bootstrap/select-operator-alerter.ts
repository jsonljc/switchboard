import {
  NoopOperatorAlerter,
  WebhookOperatorAlerter,
  type OperatorAlerter,
} from "@switchboard/core";

/**
 * Single source of truth for operator-alerter selection (D9-F1).
 *
 * Production paging is OFF unless OPERATOR_ALERT_WEBHOOK_URL is set: an unset
 * (or blank) URL yields a NoopOperatorAlerter, which logs the dropped alert at
 * error level so a misconfigured prod is visible in host logs but no human is
 * paged. When the URL is set we POST infrastructure-failure alerts to it;
 * OPERATOR_ALERT_WEBHOOK_SECRET, when present, is sent as a Bearer Authorization
 * header so a self-hosted receiver can authenticate the caller (a Slack
 * incoming-webhook ignores it and authenticates by URL secrecy).
 *
 * Env-reading stays in the apps layer; the alerter classes live in core. The
 * caller threads the SINGLE returned instance to every consumer (WorkTraceStore,
 * PlatformIngress, registerInngest) so all failure paths share one alerter and
 * the async path can never silently fall back to a Noop while the webhook is set.
 */
export function selectOperatorAlerter(env: NodeJS.ProcessEnv = process.env): OperatorAlerter {
  const webhookUrl = env.OPERATOR_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return new NoopOperatorAlerter();
  }
  const secret = env.OPERATOR_ALERT_WEBHOOK_SECRET;
  return new WebhookOperatorAlerter({
    webhookUrl,
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}
