// apps/api/src/routes/service-only-intents.ts
// ---------------------------------------------------------------------------
// Single source of truth for intents that must NEVER be accepted on an HTTP
// ingress edge — both the public `POST /api/ingress/submit` AND the
// INTERNAL_API_SECRET `POST /api/internal/ingress/submit`. These intents are
// service-only and reachable only through trusted in-process submitters (e.g.
// the HMAC-verified payments webhook, which submits `payment.record_verified`
// directly via `app.platformIngress.submit`). A caller on either HTTP edge must
// not be able to forge them (F3, docs/audits/2026-06-10-security-audit/11-tickets.md).
//
// Defence in depth — NOT the only gate: the `payment.record_verified` handler
// also requires a service/system actor AND re-verifies against the PSP, so a
// forged reference writes nothing even if this denylist were bypassed.
// ---------------------------------------------------------------------------
import { RECORD_VERIFIED_PAYMENT_INTENT } from "../bootstrap/operator-intents/record-verified-payment.js";

export const SERVICE_ONLY_INGRESS_INTENTS = new Set<string>([RECORD_VERIFIED_PAYMENT_INTENT]);

export function isServiceOnlyIngressIntent(intent: string): boolean {
  return SERVICE_ONLY_INGRESS_INTENTS.has(intent);
}
