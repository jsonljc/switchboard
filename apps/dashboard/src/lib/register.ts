const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type ValidationResult = { valid: true; error: null } | { valid: false; error: string };

export function validatePassword(password: string): ValidationResult {
  if (!password) return { valid: false, error: "Password is required" };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  return { valid: true, error: null };
}

export function validateRegistration(email: string, password: string): ValidationResult {
  if (!email) return { valid: false, error: "Email is required" };
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: "Invalid email address" };
  return validatePassword(password);
}

const SELF_SERVE_OPEN_MODES = new Set(["beta", "public"]);

/**
 * F-05: is self-serve signup currently open? Gated by NEXT_PUBLIC_LAUNCH_MODE.
 * Fail-closed allowlist: only "beta" and "public" open signup; an unset, empty, or
 * unknown mode is treated as closed ("waitlist"). Read at call time, server-side via
 * static access (so it is inlined and does not trip the F-20 no-dynamic-public-env
 * guard). The single source of truth for the register route and the NextAuth gate.
 */
export function isSelfServeSignupOpen(): boolean {
  return SELF_SERVE_OPEN_MODES.has(process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist");
}
