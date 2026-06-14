import { describe, it, expect, vi, afterEach } from "vitest";
import { validatePassword, validateRegistration, isSelfServeSignupOpen } from "../register";

describe("validateRegistration", () => {
  it("rejects missing email", () => {
    const result = validateRegistration("", "password123!");
    expect(result).toEqual({ valid: false, error: "Email is required" });
  });

  it("rejects invalid email format", () => {
    const result = validateRegistration("not-an-email", "password123!");
    expect(result).toEqual({ valid: false, error: "Invalid email address" });
  });

  it("rejects missing password", () => {
    const result = validateRegistration("user@example.com", "");
    expect(result).toEqual({ valid: false, error: "Password is required" });
  });

  it("rejects password shorter than 8 characters", () => {
    const result = validateRegistration("user@example.com", "short");
    expect(result).toEqual({
      valid: false,
      error: "Password must be at least 8 characters",
    });
  });

  it("accepts valid email and password", () => {
    const result = validateRegistration("user@example.com", "password123!");
    expect(result).toEqual({ valid: true, error: null });
  });
});

describe("validatePassword", () => {
  it("rejects an empty password", () => {
    expect(validatePassword("")).toEqual({ valid: false, error: "Password is required" });
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(validatePassword("short")).toEqual({
      valid: false,
      error: "Password must be at least 8 characters",
    });
  });

  it("accepts a password of 8 or more characters", () => {
    expect(validatePassword("longenough")).toEqual({ valid: true, error: null });
  });
});

describe("isSelfServeSignupOpen (F-05)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is closed (false) for waitlist, empty, and any unknown mode (allowlist, fail-closed)", () => {
    for (const mode of ["waitlist", "", "preview", "internal", "anything"]) {
      vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", mode);
      expect(isSelfServeSignupOpen()).toBe(false);
    }
  });

  it("is open (true) only for beta and public", () => {
    for (const mode of ["beta", "public"]) {
      vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", mode);
      expect(isSelfServeSignupOpen()).toBe(true);
    }
  });
});
