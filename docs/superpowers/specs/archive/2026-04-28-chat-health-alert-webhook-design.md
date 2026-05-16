# Chat Server Health-Check Webhook Alerter — Design

**Date:** 2026-04-28
**Branch:** `fix/launch-chat-server-observability`
**Audit blocker:** `.audit/08-launch-blocker-sequence.md` #16
**Effort:** S–M (~2–3h)

## Goal

Close the strict path of audit blocker #16: when a managed-channel health check transitions between `active` and `error`, fire a Slack-shaped webhook alert. No-op when unconfigured. Sentry initialization for the chat server (the other half of #16) is already complete.

## Non-Goals

- Generic `sendAlert(level, message, context)` utility.
- Sentry `beforeSend` mirroring.
- Retry queue, durable persistence, or delivery guarantees.
- Non-Slack payload shapes (Discord-native, PagerDuty Events, email-direct).
- Alerting on anything other than managed-channel health transitions.

## Architecture

One new module + one targeted edit. No new dependencies.

### New: `apps/chat/src/managed/alert-webhook.ts`

Single exported function:

```ts
export type HealthTransition = "failure" | "recovery";

export interface HealthAlertContext {
  channel: string; // "telegram" | "whatsapp" | "slack"
  channelId: string; // managedChannel.id
  statusDetail?: string | null;
}

export function sendHealthCheckAlert(
  transition: HealthTransition,
  ctx: HealthAlertContext,
): Promise<void>;
```

Behavior:

- Reads `ALERT_WEBHOOK_URL` per call. If unset → return immediately (no fetch).
- Builds Slack-shaped body:
  - `failure`: `{ text: "🚨 Chat health check failed: <channel>/<channelId> — <statusDetail ?? 'unknown'>" }`
  - `recovery`: `{ text: "✅ Chat health recovered: <channel>/<channelId>" }`
- `fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000) })`.
- After fetch resolves: if `!response.ok`, `console.error("[alert-webhook] failed:", response.status, response.statusText)`.
- All thrown errors caught with `console.error("[alert-webhook] error:", err)`. Never re-throws.

The function owns its own try/catch and timeout. Callers must invoke it as `void sendHealthCheckAlert(...)` so the health-check loop is never delayed by webhook delivery.

### Edit: `apps/chat/src/managed/health-checker.ts`

Today the per-channel block calls `prisma.managedChannel.update({ ... })` in five places (connection-missing, missing-token-telegram, missing-token-slack, missing-creds-whatsapp, final status update). Each computes a `nextStatus` ("active" or "error") and `statusDetail`. The change:

1. Capture `previousStatus = channel.status` (already on the row before update).
2. Replace the five inline updates with a single helper inside the loop:

   ```ts
   async function updateAndAlert(
     id: string,
     channelType: string,
     previousStatus: string,
     nextStatus: "active" | "error",
     statusDetail: string | null,
   ): Promise<void> {
     await prisma.managedChannel.update({
       where: { id },
       data: { status: nextStatus, statusDetail, lastHealthCheck: new Date() },
     });

     const wasError = previousStatus === "error";
     const nowError = nextStatus === "error";
     if (!wasError && nowError) {
       void sendHealthCheckAlert("failure", { channel: channelType, channelId: id, statusDetail });
     } else if (wasError && !nowError) {
       void sendHealthCheckAlert("recovery", { channel: channelType, channelId: id });
     }
   }
   ```

3. The transition matrix (locked):

   | from \ to                | active       | error       |
   | ------------------------ | ------------ | ----------- |
   | active                   | silent       | **failure** |
   | error                    | **recovery** | silent      |
   | unknown / pending / null | silent       | **failure** |

   Recovery fires only on `error → active`. Initial-state transitions (unknown/pending → active) are silent.

No other behavior in `health-checker.ts` changes. Interval, timeout, error-swallowing in the outer loop, and per-channel logic stay intact.

## Failure Semantics

- Webhook delivery is non-awaited from the health-checker. The loop continues immediately after dispatching the alert.
- The alerter has a 5-second internal timeout. Worst case: a hung POST is abandoned silently after 5s.
- Webhook POST never throws back to the loop. Errors logged to `console.error`.
- Non-2xx responses logged but not retried.
- If `ALERT_WEBHOOK_URL` is unset, the alerter is a no-op.

## Tests

### `apps/chat/src/managed/__tests__/alert-webhook.test.ts`

1. **No-op when `ALERT_WEBHOOK_URL` unset** — `fetch` is not called.
2. **Failure transition** — POSTs Slack-shaped `{ text: "🚨 Chat health check failed: ..." }` with the configured URL, content-type header, and the `statusDetail` interpolated.
3. **Recovery transition** — POSTs `{ text: "✅ Chat health recovered: ..." }`.
4. **Swallows fetch rejection** — `fetch` mocked to reject; `sendHealthCheckAlert` resolves and logs via `console.error`.
5. **Logs non-2xx without throwing** — `fetch` returns `{ ok: false, status: 500, statusText: "Internal Server Error" }`; resolves and logs.

### `apps/chat/src/managed/__tests__/health-checker.test.ts` (new file)

Mocks `prisma` (`managedChannel.findMany`, `managedChannel.update`) and `fetch`. Drives the loop manually (export an internal `runHealthCheck(prisma)` or extract checkAll for testability). Asserts:

- `active → error` → one webhook POST with failure body.
- `error → error` → zero webhook POSTs.
- `error → active` → one webhook POST with recovery body.
- `active → active` → zero webhook POSTs.
- `unknown → error` → one webhook POST with failure body.
- `unknown → active` → zero webhook POSTs.

If extracting `runHealthCheck` is too invasive, drive the same matrix via direct calls to a small extracted `decideTransitionAlert(previousStatus, nextStatus)` helper plus a focused integration test for one happy path. Prefer the extraction-and-export route — keeps tests honest.

## Env / Docs

- Add to `.env.example`:

  ```
  # Optional: webhook URL (Slack incoming webhook or compatible) for chat health alerts.
  # Receives Slack-shaped { text } payloads on managed-channel active↔error transitions.
  # Unset = alerts disabled.
  ALERT_WEBHOOK_URL=
  ```

## Acceptance

- `apps/chat/src/managed/alert-webhook.ts` exists and exports `sendHealthCheckAlert`.
- `apps/chat/src/managed/health-checker.ts` dispatches `void sendHealthCheckAlert(...)` only on `active/unknown → error` and `error → active` transitions.
- Webhook delivery is non-blocking; health-check loop unaffected by webhook latency or failure.
- Non-2xx responses are logged via `console.error`.
- Five unit tests for the alerter pass.
- Six transition-matrix tests for the health-checker pass.
- `pnpm --filter @switchboard/chat test` and `pnpm --filter @switchboard/chat typecheck` green.
- `.env.example` updated.

## Out of Scope (explicit)

- Replacing or expanding Sentry's role on chat. Sentry already initializes via `apps/chat/src/bootstrap/sentry.ts`; that's the answer for app-error alerting.
- Adding alerts to other code paths (escalations, conversations, ad-optimizer crons).
- Aggregation, suppression windows, or escalation chains beyond the simple transition trigger.
