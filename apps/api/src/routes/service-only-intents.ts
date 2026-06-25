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
//
// `adoptimizer.campaign.reset_prior_budget` is here for a different reason: it is
// an ALLOW-ONLY, auto-executing money move whose ONLY legitimate submitter is the
// in-process guardrail monitor (it restores the budget to a prior the executor
// captured). Its `allowedTriggers:["internal"]` does NOT keep it off the HTTP edge
// (both ingress routes accept `trigger:"internal"` from the request body), and
// unlike the forward `reallocate` intent it does not park for mandatory approval
// (allow-only auto-executes) and carries no blast-radius cap (it is bounded only by
// the monitor sourcing `targetCents` from the captured prior). Without this guard an
// authenticated operator could POST it with an arbitrary `targetCents` and set any of
// their own campaigns' budgets with no approval. This denylist is what enforces the
// "in-process submitter only" trust model the intent's design depends on.
// ---------------------------------------------------------------------------
import { RECORD_VERIFIED_PAYMENT_INTENT } from "../bootstrap/operator-intents/record-verified-payment.js";
import { RILEY_RESET_PRIOR_BUDGET_INTENT } from "../services/workflows/riley-reset-budget-submit-request.js";

export const SERVICE_ONLY_INGRESS_INTENTS = new Set<string>([
  RECORD_VERIFIED_PAYMENT_INTENT,
  RILEY_RESET_PRIOR_BUDGET_INTENT,
]);

export function isServiceOnlyIngressIntent(intent: string): boolean {
  return SERVICE_ONLY_INGRESS_INTENTS.has(intent);
}
