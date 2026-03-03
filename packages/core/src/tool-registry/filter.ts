/**
 * Simple glob matching for action type patterns.
 * Supports `*` as a wildcard that matches any substring.
 *
 * Examples:
 *   "patient-engagement.*"  matches "patient-engagement.appointment.book"
 *   "crm.*"                 matches "crm.contact.search"
 *   "crm.contact.*"         matches "crm.contact.search" but not "crm.deal.list"
 *   "*"                     matches everything
 */
export function matchGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true;

  // Convert glob pattern to regex: escape special chars, replace * with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}

/**
 * Check if an action type matches any pattern in a list of globs.
 */
export function matchesAny(actionType: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchGlob(pattern, actionType));
}
