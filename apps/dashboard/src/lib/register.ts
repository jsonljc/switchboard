const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateRegistration(
  email: string,
  password: string,
): { valid: true; error: null } | { valid: false; error: string } {
  if (!email) return { valid: false, error: "Email is required" };
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: "Invalid email address" };
  if (!password) return { valid: false, error: "Password is required" };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  return { valid: true, error: null };
}
