import { describe, it, expect } from "vitest";
import { isPublicRoute, MUTATING_METHODS } from "../billing-guard.js";

describe("billing-guard helpers", () => {
  describe("MUTATING_METHODS", () => {
    it("includes POST/PUT/PATCH/DELETE", () => {
      expect(MUTATING_METHODS).toEqual(new Set(["POST", "PUT", "PATCH", "DELETE"]));
    });
  });

  describe("isPublicRoute", () => {
    it.each([
      ["/health", true],
      ["/api/health", true],
      ["/api/health/db", true],
      ["/api/setup/start", true],
      ["/api/setup/finish", true],
      ["/api/sessions", true],
      ["/api/sessions/refresh", true],
      ["/api/billing/checkout", true],
      ["/api/billing/portal", true],
      ["/api/billing/webhook", true],
      ["/api/webhooks/meta", true],
      ["/api/webhooks/stripe", true],
      ["/api/actions/propose", false],
      ["/api/agents/deploy", false],
      ["/api/conversations/123/reply", false],
      ["/api/ingress", false],
    ])("isPublicRoute(%s) === %s", (url, expected) => {
      expect(isPublicRoute(url)).toBe(expected);
    });
  });
});
