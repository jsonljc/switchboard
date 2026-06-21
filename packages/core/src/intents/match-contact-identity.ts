import { normalizeEmail } from "../identity/normalize.js";

export interface MatchIdentity {
  phoneE164: string | null;
  /** Caller passes the lowercased/trimmed email (normalizeEmail), or null. */
  email: string | null;
  name: string | null;
}

export interface MatchCandidate {
  id: string;
  phoneE164: string | null;
  /** May be a raw (pre-normalization) email on legacy rows; normalized here at comparison. */
  email: string | null;
  name: string | null;
}

export type MatchDecision =
  | { kind: "create" }
  | { kind: "reuse"; contactId: string }
  | { kind: "create_flagged" };

/** Corroboration key: trim, collapse internal whitespace, lowercase. Empty/whitespace -> null. */
export function normalizeName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const n = name.trim().replace(/\s+/g, " ").toLowerCase();
  return n.length > 0 ? n : null;
}

function emailKey(email: string | null): string | null {
  if (email == null) return null;
  const e = normalizeEmail(email);
  return e.length > 0 ? e : null;
}

/** Both sides have a non-empty name and they match after normalization. */
function namesCorroborate(a: MatchIdentity, c: MatchCandidate): boolean {
  const an = normalizeName(a.name);
  const cn = normalizeName(c.name);
  return an !== null && cn !== null && an === cn;
}

/** A field conflicts only when BOTH sides are non-null and differ (after normalization). Null != conflict. */
function fieldConflict(a: MatchIdentity, c: MatchCandidate): boolean {
  const aEmail = emailKey(a.email);
  const cEmail = emailKey(c.email);
  const emailConflict = aEmail !== null && cEmail !== null && aEmail !== cEmail;
  const phoneConflict = a.phoneE164 !== null && c.phoneE164 !== null && a.phoneE164 !== c.phoneE164;
  return emailConflict || phoneConflict;
}

/**
 * D1 decision: reuse ONLY on an exact single match corroborated by name with no conflicting field;
 * flag (create a separate record, never merge) on ambiguity (>1) or any conflict/uncorroborated match.
 * Fails closed: anything short of a positively corroborated single match creates a fresh record.
 */
export function decideContactMatch(
  incoming: MatchIdentity,
  candidates: MatchCandidate[],
): MatchDecision {
  if (candidates.length === 0) return { kind: "create" };
  if (candidates.length > 1) return { kind: "create_flagged" };
  const c = candidates[0];
  // Length is exactly 1 here; the guard satisfies noUncheckedIndexedAccess and fails closed to create.
  if (!c) return { kind: "create" };
  if (namesCorroborate(incoming, c) && !fieldConflict(incoming, c)) {
    return { kind: "reuse", contactId: c.id };
  }
  return { kind: "create_flagged" };
}
