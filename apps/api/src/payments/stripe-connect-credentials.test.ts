import { describe, it, expect } from "vitest";
import { parseStripeConnectCredentials } from "./stripe-connect-credentials.js";

describe("parseStripeConnectCredentials", () => {
  it("parses the two live-adapter fields and ignores extras (incl. a legacy webhookSecret)", () => {
    const parsed = parseStripeConnectCredentials({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_legacy", // post-#984: ignored, not part of the contract
      extra: "ignored",
    });
    expect(parsed).toEqual({ connectedAccountId: "acct_1", secretKey: "sk_live_x" });
  });

  it("parses when NO per-org webhookSecret is present (verification uses the platform secret)", () => {
    const parsed = parseStripeConnectCredentials({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
    });
    expect(parsed).toEqual({ connectedAccountId: "acct_1", secretKey: "sk_live_x" });
  });

  it.each([
    ["missing connectedAccountId", { secretKey: "sk" }],
    ["missing secretKey", { connectedAccountId: "acct" }],
    ["blank secretKey", { connectedAccountId: "acct", secretKey: "  " }],
    ["non-string secretKey", { connectedAccountId: "acct", secretKey: 123 }],
    ["blank connectedAccountId", { connectedAccountId: "  ", secretKey: "sk" }],
    ["empty object", {}],
  ])("returns null when %s (fail-closed)", (_label, creds) => {
    expect(parseStripeConnectCredentials(creds as Record<string, unknown>)).toBeNull();
  });
});
