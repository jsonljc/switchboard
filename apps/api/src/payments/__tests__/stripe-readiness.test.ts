import { describe, it, expect } from "vitest";
import {
  classifyStripeReadiness,
  STRIPE_LIVE_CONNECTION_STATUS,
  describeReadiness,
  resolveRedirectPrecondition,
  resolveWebhookPrecondition,
  assembleOrgReadiness,
} from "../stripe-readiness.js";

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

describe("describeReadiness", () => {
  it("formats each reason and never includes the secret", () => {
    const ready = describeReadiness({
      live: true,
      reason: "ready",
      connectedAccountId: "acct_1",
      externalAccountId: "acct_1",
      status: "connected",
    });
    expect(ready).toContain("LIVE");
    expect(ready).toContain("acct_1");

    const mismatch = describeReadiness({
      live: false,
      reason: "account_mismatch",
      connectedAccountId: "acct_1",
      externalAccountId: "acct_2",
      status: "connected",
    });
    expect(mismatch).toContain("NOOP");
    expect(mismatch).toContain("acct_1");
    expect(mismatch).toContain("acct_2");

    const unreadable = describeReadiness({
      live: false,
      reason: "credentials_unreadable",
      connectedAccountId: null,
      externalAccountId: "acct_1",
      status: "connected",
    });
    expect(unreadable).toContain("NOOP");
    expect(unreadable.toLowerCase()).toContain("decrypt");
  });
});

describe("resolveRedirectPrecondition", () => {
  it("uses PAYMENT_PUBLIC_URL when set", () => {
    const r = resolveRedirectPrecondition({ PAYMENT_PUBLIC_URL: "https://app.example.com/" });
    expect(r).toMatchObject({
      ok: true,
      source: "PAYMENT_PUBLIC_URL",
      effectiveBaseUrl: "https://app.example.com",
    });
  });

  it("falls back to DASHBOARD_URL when PAYMENT_PUBLIC_URL is blank", () => {
    const r = resolveRedirectPrecondition({
      PAYMENT_PUBLIC_URL: "   ",
      DASHBOARD_URL: "https://dash.example.com",
    });
    expect(r).toMatchObject({ ok: true, source: "DASHBOARD_URL" });
  });

  it("warns (not ok) when neither is set", () => {
    const r = resolveRedirectPrecondition({});
    expect(r).toMatchObject({ ok: false, source: "fallback", effectiveBaseUrl: null });
  });
});

describe("resolveWebhookPrecondition", () => {
  it("ok only when both secrets are present, and never returns the values", () => {
    const ok = resolveWebhookPrecondition({
      STRIPE_SECRET_KEY: "sk_x",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_x",
    });
    expect(ok).toEqual({ ok: true, stripeSecretKeySet: true, connectWebhookSecretSet: true });

    const missing = resolveWebhookPrecondition({ STRIPE_SECRET_KEY: "sk_x" });
    expect(missing).toEqual({
      ok: false,
      stripeSecretKeySet: true,
      connectWebhookSecretSet: false,
    });
    expect(JSON.stringify(missing)).not.toContain("sk_x");
  });
});

describe("assembleOrgReadiness", () => {
  const decryptMatching = () => ({ connectedAccountId: "acct_1", secretKey: "sk_live_x" });

  it("no_connection for a null row without decrypting", () => {
    let called = false;
    const r = assembleOrgReadiness(null, () => {
      called = true;
      return {};
    });
    expect(r.reason).toBe("no_connection");
    expect(called).toBe(false);
  });

  it("status_not_connected without decrypting a non-connected row", () => {
    let called = false;
    const r = assembleOrgReadiness(
      { credentials: "enc", externalAccountId: "acct_1", status: "disconnected" },
      () => {
        called = true;
        return decryptMatching();
      },
    );
    expect(r.reason).toBe("status_not_connected");
    expect(called).toBe(false);
  });

  it("credentials_unreadable when decrypt throws", () => {
    const r = assembleOrgReadiness(
      { credentials: "enc", externalAccountId: "acct_1", status: "connected" },
      () => {
        throw new Error("bad auth tag");
      },
    );
    expect(r).toMatchObject({ live: false, reason: "credentials_unreadable" });
  });

  it("ready for a connected, matching, decryptable row, and never carries the secret", () => {
    const r = assembleOrgReadiness(
      { credentials: "enc", externalAccountId: "acct_1", status: "connected" },
      () => ({ connectedAccountId: "acct_1", secretKey: "sk_live_SENTINEL" }),
    );
    expect(r).toMatchObject({ live: true, reason: "ready", connectedAccountId: "acct_1" });
    expect(JSON.stringify(r)).not.toContain("sk_live_SENTINEL");
  });
});
