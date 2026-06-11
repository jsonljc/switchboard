import { describe, it, expect } from "vitest";
import {
  SERVICE_ONLY_INGRESS_INTENTS,
  isServiceOnlyIngressIntent,
} from "./service-only-intents.js";
import { RECORD_VERIFIED_PAYMENT_INTENT } from "../bootstrap/operator-intents/record-verified-payment.js";

describe("service-only ingress intents", () => {
  it("payment.record_verified is service-only (F3)", () => {
    expect(isServiceOnlyIngressIntent(RECORD_VERIFIED_PAYMENT_INTENT)).toBe(true);
    expect(SERVICE_ONLY_INGRESS_INTENTS.has("payment.record_verified")).toBe(true);
  });

  it("ordinary operator intents are NOT service-only", () => {
    expect(isServiceOnlyIngressIntent("operator.record_revenue")).toBe(false);
    expect(isServiceOnlyIngressIntent("alex.respond")).toBe(false);
  });
});
