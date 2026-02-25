/**
 * Synchronous deterministic JSON serialization (RFC 8785 JCS subset).
 * Recursively sorts object keys and serializes to a canonical string.
 * No external dependencies, no async.
 */
export function canonicalizeSync(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeSync(item)).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort();
    const entries = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalizeSync((value as Record<string, unknown>)[k]),
    );
    return "{" + entries.join(",") + "}";
  }
  return "null";
}
