import { describe, it, expect } from "vitest";
import {
  SERVICE_ONLY_INGRESS_INTENTS,
  isServiceOnlyIngressIntent,
} from "./service-only-intents.js";
import { RECORD_VERIFIED_PAYMENT_INTENT } from "../bootstrap/operator-intents/record-verified-payment.js";
import { RILEY_RESET_PRIOR_BUDGET_INTENT } from "../services/workflows/riley-reset-budget-submit-request.js";

describe("service-only ingress intents", () => {
  it("payment.record_verified is service-only (F3)", () => {
    expect(isServiceOnlyIngressIntent(RECORD_VERIFIED_PAYMENT_INTENT)).toBe(true);
    expect(SERVICE_ONLY_INGRESS_INTENTS.has("payment.record_verified")).toBe(true);
  });

  it("reset_prior_budget is service-only: an allow-only auto-executing money move must never be forgeable on an HTTP edge", () => {
    // allowedTriggers:["internal"] does NOT keep it off the edge (both ingress routes accept
    // trigger:"internal" from the body); this denylist is the actual gate. Without it an operator
    // could POST an arbitrary targetCents and set any of their campaigns' budgets with no approval.
    expect(isServiceOnlyIngressIntent(RILEY_RESET_PRIOR_BUDGET_INTENT)).toBe(true);
    expect(SERVICE_ONLY_INGRESS_INTENTS.has("adoptimizer.campaign.reset_prior_budget")).toBe(true);
  });

  it("the forward reallocate intent is NOT service-only (it parks for mandatory approval instead)", () => {
    // The asymmetry: reallocate is reachable on the edge but SAFE because it parks at mandatory; the
    // reset auto-executes (allow-only), so it must be blocked at the edge instead.
    expect(isServiceOnlyIngressIntent("adoptimizer.campaign.reallocate")).toBe(false);
  });

  it("ordinary operator intents are NOT service-only", () => {
    expect(isServiceOnlyIngressIntent("operator.record_revenue")).toBe(false);
    expect(isServiceOnlyIngressIntent("alex.respond")).toBe(false);
  });
});
