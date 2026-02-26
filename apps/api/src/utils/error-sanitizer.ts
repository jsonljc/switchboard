/**
 * Sanitizes error messages before returning them to API clients.
 * Prevents leaking internal details like SQL errors, stack traces,
 * hostnames, connection strings, and IP addresses.
 */

const SENSITIVE_PATTERNS = [
  /SELECT\s|INSERT\s|UPDATE\s|DELETE\s|DROP\s|ALTER\s|CREATE\s/i, // SQL
  /at\s+\S+\s+\(.*:\d+:\d+\)/,  // stack traces
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IPv4
  /postgresql:\/\/|mysql:\/\/|redis:\/\/|mongodb:\/\/|amqp:\/\//i, // connection strings
  /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i, // Node network errors
  /prisma|PrismaClient/i, // ORM internals
];

export function sanitizeErrorMessage(err: unknown, statusCode: number): string {
  if (statusCode >= 500) {
    return "Internal server error";
  }

  const message = err instanceof Error ? err.message : String(err);

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      return "Request failed";
    }
  }

  return message;
}

export function sanitizeHealthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Redact connection URLs and IPs but preserve service status info
  return message
    .replace(/(?:postgresql|mysql|redis|mongodb|amqp):\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, "[redacted-ip]");
}
