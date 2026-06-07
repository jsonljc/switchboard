import { describe, it, expect } from "vitest";
import { parseStripeConnectCredentials } from "./stripe-connect-credentials.js";

describe("parseStripeConnectCredentials", () => {
  it("parses full Connect credentials", () => {
    const parsed = parseStripeConnectCredentials({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_x",
      extra: "ignored",
    });
    expect(parsed).toEqual({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_x",
    });
  });

  it.each([
    ["missing connectedAccountId", { secretKey: "sk", webhookSecret: "wh" }],
    ["missing secretKey", { connectedAccountId: "acct", webhookSecret: "wh" }],
    ["missing webhookSecret", { connectedAccountId: "acct", secretKey: "sk" }],
    ["blank secretKey", { connectedAccountId: "acct", secretKey: "  ", webhookSecret: "wh" }],
    ["non-string secretKey", { connectedAccountId: "acct", secretKey: 123, webhookSecret: "wh" }],
    ["empty object", {}],
  ])("returns null when %s (fail-closed)", (_label, creds) => {
    expect(parseStripeConnectCredentials(creds as Record<string, unknown>)).toBeNull();
  });
});
