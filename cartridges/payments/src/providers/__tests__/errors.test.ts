import { describe, it, expect } from "vitest";
import {
  StripeApiError,
  StripeRateLimitError,
  StripeAuthError,
  StripeNotFoundError,
} from "../errors.js";

describe("Stripe error classes", () => {
  describe("StripeApiError", () => {
    it("should set all properties", () => {
      const err = new StripeApiError(
        "bad request",
        "invalid_request_error",
        "invalid_param",
        "amount",
        400,
      );
      expect(err.message).toBe("bad request");
      expect(err.type).toBe("invalid_request_error");
      expect(err.code).toBe("invalid_param");
      expect(err.param).toBe("amount");
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe("StripeApiError");
      expect(err).toBeInstanceOf(Error);
    });

    it("should work without optional params", () => {
      const err = new StripeApiError("oops", "api_error", "generic");
      expect(err.param).toBeUndefined();
      expect(err.statusCode).toBeUndefined();
    });
  });

  describe("StripeRateLimitError", () => {
    it("should set rate limit defaults", () => {
      const err = new StripeRateLimitError("Too many requests");
      expect(err.name).toBe("StripeRateLimitError");
      expect(err.type).toBe("rate_limit_error");
      expect(err.code).toBe("rate_limit");
      expect(err.statusCode).toBe(429);
      expect(err).toBeInstanceOf(StripeApiError);
    });
  });

  describe("StripeAuthError", () => {
    it("should set auth defaults", () => {
      const err = new StripeAuthError("Invalid API key");
      expect(err.name).toBe("StripeAuthError");
      expect(err.type).toBe("authentication_error");
      expect(err.code).toBe("auth_failed");
      expect(err.statusCode).toBe(401);
      expect(err).toBeInstanceOf(StripeApiError);
    });
  });

  describe("StripeNotFoundError", () => {
    it("should format the not-found message", () => {
      const err = new StripeNotFoundError("customer", "cus_123");
      expect(err.message).toBe("No such customer: 'cus_123'");
      expect(err.name).toBe("StripeNotFoundError");
      expect(err.type).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
      expect(err.param).toBe("customer");
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(StripeApiError);
    });
  });
});
