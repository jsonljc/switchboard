import { describe, it, expect } from "vitest";
import { provisionStatusMessage } from "../provision-status-message";

describe("provisionStatusMessage", () => {
  it("returns null for active", () => {
    expect(provisionStatusMessage({ status: "active", statusDetail: null })).toBeNull();
  });

  it("returns mapped friendly string for config_error and never the raw detail", () => {
    const detail = "Missing env var CHAT_PUBLIC_URL and INTERNAL_API_SECRET";
    const msg = provisionStatusMessage({ status: "config_error", statusDetail: detail });
    expect(msg).toBe(
      "Channel setup can't complete because the platform is not fully configured. Please contact support.",
    );
    expect(msg).not.toContain("CHAT_PUBLIC_URL");
    expect(msg).not.toContain("INTERNAL_API_SECRET");
  });

  it("returns mapped friendly string for pending_chat_register", () => {
    expect(
      provisionStatusMessage({
        status: "pending_chat_register",
        statusDetail: "router timeout",
      }),
    ).toBe(
      "Connection registered with WhatsApp, but our message router didn't acknowledge yet. Please retry, or contact support if this persists.",
    );
  });

  it("returns mapped friendly string for pending_meta_register", () => {
    expect(
      provisionStatusMessage({
        status: "pending_meta_register",
        statusDetail: "Meta /subscribed_apps returned 500",
      }),
    ).toBe(
      "We saved your connection, but couldn't fully register the webhook with Meta. Please retry, or contact support if this persists.",
    );
  });

  it("returns mapped friendly string for health_check_failed", () => {
    expect(
      provisionStatusMessage({
        status: "health_check_failed",
        statusDetail: "graph.facebook.com returned 401",
      }),
    ).toBe(
      "We couldn't verify the WhatsApp credentials. Please double-check the access token and phone number ID.",
    );
  });

  it("returns the v1-limit detail verbatim when status is error and detail is safe", () => {
    const v1Detail =
      "v1 limit: this organization already has a WhatsApp channel connected. Multi-number support is not available in v1.";
    expect(provisionStatusMessage({ status: "error", statusDetail: v1Detail })).toBe(v1Detail);
  });

  it("returns SAFE_ERROR_FALLBACK when status is error and detail contains an env var name", () => {
    expect(
      provisionStatusMessage({
        status: "error",
        statusDetail: "Missing WHATSAPP_GRAPH_TOKEN environment variable",
      }),
    ).toBe("Channel setup didn't complete. Please contact support.");
  });

  it("returns SAFE_ERROR_FALLBACK when error detail contains phoneNumberId-like digits", () => {
    expect(
      provisionStatusMessage({
        status: "error",
        statusDetail: "phoneNumberId 1234567890123 already linked",
      }),
    ).toBe("Channel setup didn't complete. Please contact support.");
  });

  it("returns SAFE_ERROR_FALLBACK when error detail contains a long token-like string", () => {
    expect(
      provisionStatusMessage({
        status: "error",
        statusDetail: "token rejected: EAABsbCS1iHgBAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      }),
    ).toBe("Channel setup didn't complete. Please contact support.");
  });

  it("returns SAFE_ERROR_FALLBACK when error detail is empty", () => {
    expect(provisionStatusMessage({ status: "error", statusDetail: null })).toBe(
      "Channel setup didn't complete. Please contact support.",
    );
    expect(provisionStatusMessage({ status: "error", statusDetail: "" })).toBe(
      "Channel setup didn't complete. Please contact support.",
    );
  });

  it("returns SAFE_FALLBACK for unknown status", () => {
    expect(
      provisionStatusMessage({
        status: "something_unexpected",
        statusDetail: null,
      }),
    ).toBe("Channel setup is not complete yet. Please review the connection status.");
  });

  it("returns mapped string for non-active status with null detail", () => {
    expect(provisionStatusMessage({ status: "pending_meta_register", statusDetail: null })).toBe(
      "We saved your connection, but couldn't fully register the webhook with Meta. Please retry, or contact support if this persists.",
    );
  });
});
