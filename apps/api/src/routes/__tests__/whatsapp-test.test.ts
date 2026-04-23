import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { testWhatsAppCredentials } from "../whatsapp-test.js";

describe("testWhatsAppCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success for valid credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        verified_name: "Test Business",
        display_phone_number: "+1234567890",
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "123456");
    expect(result).toEqual({
      success: true,
      verifiedName: "Test Business",
      displayPhoneNumber: "+1234567890",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/123456?access_token=valid-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns invalid-token error for Graph API code 190", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Invalid OAuth access token",
          type: "OAuthException",
          code: 190,
        },
      }),
    });

    const result = await testWhatsAppCredentials("bad-token", "123456");
    expect(result).toEqual({
      success: false,
      error: "Invalid access token. Check that you copied the full token.",
      statusCode: 401,
    });
  });

  it("returns not-found error for Graph API code 100 (invalid parameter)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Unsupported get request. Object with ID '999999' does not exist",
          type: "GraphMethodException",
          code: 100,
        },
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "999999");
    expect(result).toEqual({
      success: false,
      error: "Phone Number ID not found. Verify the ID in your Meta Business Suite.",
      statusCode: 404,
    });
  });

  it("returns not-found error for HTTP 404", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { message: "does not exist", code: 803 },
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "999999");
    expect(result).toEqual({
      success: false,
      error: "Phone Number ID not found. Verify the ID in your Meta Business Suite.",
      statusCode: 404,
    });
  });

  it("returns error for network timeout", async () => {
    mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    const result = await testWhatsAppCredentials("valid-token", "123456");
    expect(result).toEqual({
      success: false,
      error: "Could not reach Meta's servers. Check your network and try again.",
      statusCode: 504,
    });
  });

  it("returns generic error for unknown Graph API error codes", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Some unknown API error",
          code: 9999,
        },
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "123456");
    expect(result).toEqual({
      success: false,
      error: "Meta API error: Some unknown API error",
      statusCode: 400,
    });
  });
});
