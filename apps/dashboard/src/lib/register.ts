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
