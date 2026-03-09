import { describe, it, expect } from "vitest";
import { MetaApiError, MetaRateLimitError, MetaAuthError } from "../errors.js";

describe("MetaApiError", () => {
  it("stores code, subcode, type, and fbtrace_id", () => {
    const err = new MetaApiError("Something went wrong", 100, 33, "OAuthException", "trace123");
    expect(err.message).toBe("Something went wrong");
    expect(err.code).toBe(100);
    expect(err.subcode).toBe(33);
    expect(err.type).toBe("OAuthException");
    expect(err.fbtraceId).toBe("trace123");
    expect(err.name).toBe("MetaApiError");
  });

  it("is an instance of Error", () => {
    const err = new MetaApiError("test", 1, 0, "unknown");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MetaApiError);
  });

  it("works without optional fbtraceId", () => {
    const err = new MetaApiError("msg", 42, 0, "ApiException");
    expect(err.fbtraceId).toBeUndefined();
  });
});

describe("MetaRateLimitError", () => {
  it("always sets code to 17", () => {
    const err = new MetaRateLimitError("Too many calls", 2446079);
    expect(err.code).toBe(17);
    expect(err.subcode).toBe(2446079);
    expect(err.type).toBe("OAuthException");
    expect(err.name).toBe("MetaRateLimitError");
  });

  it("is an instance of MetaApiError", () => {
    const err = new MetaRateLimitError("rate limited", 0);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toBeInstanceOf(MetaRateLimitError);
  });
});

describe("MetaAuthError", () => {
  it("stores the provided code (e.g. 190)", () => {
    const err = new MetaAuthError("Invalid token", 190, 463);
    expect(err.code).toBe(190);
    expect(err.subcode).toBe(463);
    expect(err.type).toBe("OAuthException");
    expect(err.name).toBe("MetaAuthError");
  });

  it("is an instance of MetaApiError", () => {
    const err = new MetaAuthError("expired", 190, 0);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toBeInstanceOf(MetaAuthError);
  });
});
