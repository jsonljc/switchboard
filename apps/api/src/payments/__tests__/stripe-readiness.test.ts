import { describe, it, expect } from "vitest";
import { classifyStripeReadiness, STRIPE_LIVE_CONNECTION_STATUS } from "../stripe-readiness.js";

const matchingCreds = { connectedAccountId: "acct_1", secretKey: "sk_live_x" };

describe("classifyStripeReadiness", () => {
  it("no_connection when the connection is null", () => {
    const v = classifyStripeReadiness(null, null);
    expect(v).toMatchObject({ live: false, reason: "no_connection", status: null });
  });

  it("status_not_connected when the connection status is not 'connected'", () => {
    const v = classifyStripeReadiness(
      { status: "disconnected", externalAccountId: "acct_1" },
      matchingCreds,
    );
    expect(v).toMatchObject({
      live: false,
      reason: "status_not_connected",
      status: "disconnected",
    });
  });

  it("credentials_incomplete when parsed credentials are null", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_1" },
      null,
    );
    expect(v).toMatchObject({ live: false, reason: "credentials_incomplete" });
  });

  it("account_mismatch when connectedAccountId differs from externalAccountId", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_2" },
      matchingCreds,
    );
    expect(v).toMatchObject({
      live: false,
      reason: "account_mismatch",
      connectedAccountId: "acct_1",
      externalAccountId: "acct_2",
    });
  });

  it("account_mismatch when externalAccountId is null even with full creds", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: null },
      matchingCreds,
    );
    expect(v).toMatchObject({ live: false, reason: "account_mismatch", externalAccountId: null });
  });

  it("ready (live) when connected, complete, and accounts match", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_1" },
      matchingCreds,
    );
    expect(v).toMatchObject({ live: true, reason: "ready", connectedAccountId: "acct_1" });
  });

  it("never returns the secret key in the verdict", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_1" },
      { connectedAccountId: "acct_1", secretKey: "sk_live_SENTINEL" },
    );
    expect(JSON.stringify(v)).not.toContain("sk_live_SENTINEL");
  });
});
