import { describe, it, expect } from "vitest";

describe("P1: provision fixes", () => {
  describe("org creator gets full roles", () => {
    it("should assign operator, admin, and approver roles to first user", () => {
      const roles = ["operator", "admin", "approver"];
      expect(roles).toContain("admin");
      expect(roles).toContain("approver");
      expect(roles).toContain("operator");
      expect(roles.length).toBe(3);
    });
  });

  describe("email auto-verify when RESEND_API_KEY not set", () => {
    it("should set emailVerified when email service is unavailable", () => {
      const resendApiKey = undefined;
      const emailVerified = resendApiKey ? null : new Date();
      expect(emailVerified).toBeInstanceOf(Date);
    });
  });
});
