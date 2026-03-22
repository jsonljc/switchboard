# OpenClaw gateway HTTP contract (Switchboard assumptions)

Switchboard’s **Phase 2B** HTTP adapter targets a gateway that exposes JSON RPC-style endpoints under a single base URL (`OPENCLAW_GATEWAY_URL`). The real OpenClaw product may name routes differently; this document is the **compatibility surface implemented in-repo** so non-prod stacks can align without guessing.

## Endpoints

| Method | Path      | Purpose                                                                                                                                                                                                           |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/invoke` | Initial or resume invocation (body: `GatewayInitialInvokeRequest` or `GatewayResumeInvokeRequest`)                                                                                                                |
| `POST` | `/cancel` | Best-effort cancellation (JSON body: `{ sessionId, runId, sessionToken, traceId }`)                                                                                                                               |
| `GET`  | `/health` | Liveness (`{ ok: boolean, version?: string }`) — also used by the API process on an interval (`OPENCLAW_GATEWAY_HEALTH_PROBE_INTERVAL_MS`) so the circuit breaker can recover without waiting for the next invoke |

## Worker-side cancellation

When `POST /api/sessions/:id/cancel` runs with the full OpenClaw stack, Switchboard **aborts the in-flight fetch** for that session’s BullMQ job (shared `AbortSignal`) **before** calling gateway `/cancel` and local `cancelSession`. Late gateway responses remain safe via the locked outcome applier.

## Headers (outbound from Switchboard)

Every `POST` sends:

- `Authorization: Bearer <sessionToken>` — same JWT issued for tool calls
- `Content-Type: application/json`
- `X-Switchboard-Trace-Id: <traceId>` — duplicates `traceId` in the JSON for log/search alignment

## Correlation (inbound)

After a successful HTTP response, Switchboard merges correlation metadata into `GatewayInvokeResponse.correlation`:

- **Gateway request id:** first non-empty among `x-gateway-request-id`, `x-request-id`
- **Runtime correlation id:** first non-empty among `x-openclaw-correlation-id`, `x-correlation-id`, `x-trace-id`

The JSON body may also include `correlation`; header values override body fields when both are present.

## Tool events

**Model:** **terminal batch only** — each `/invoke` response may include `toolCalls[]` for that invocation window. Incremental/streamed tool delivery is not wired in Phase 2B; use the callback endpoint or extend the schema when OpenClaw exposes a stable streaming contract.

Each `toolCalls[]` entry **must** include `idempotencyKey` (Zod `min(1)`). Switchboard dedupes via `gatewayIdempotencyKey` in storage.

## Auth errors

`401` / `403` → `GatewayRejectedAuthError` (non-retryable; session failed).
