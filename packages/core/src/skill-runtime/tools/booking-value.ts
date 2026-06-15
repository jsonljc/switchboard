import type { PlaybookService } from "@switchboard/schemas";

export interface ResolveBookedValueInput {
  /**
   * The service being booked, as passed to the calendar-book tool. This is the
   * free-text service string Alex captured from the conversation (see skills/alex
   * SKILL.md "service: the service they discussed"), so it may be either a
   * playbook service `id` or its display `name`.
   */
  service: string;
  /** The org's playbook services, or undefined when no playbook is available. */
  services: readonly PlaybookService[] | undefined | null;
}

/** trim + lowercase for case-insensitive exact name matching. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve the booked value of a service in CENTS from the org's playbook,
 * abstaining to `null` whenever a real numeric price is not available.
 *
 * Design crux (Riley D3-1): bounded + abstaining + never-fabricate. The playbook
 * persists per-service `price` as an OPTIONAL number in MAJOR units (dollars; the
 * onboarding UI renders `$${service.price}`), while `Opportunity.estimatedValue`
 * is stored in CENTS. A matched, finite, positive price converts major -> cents via
 * `Math.round(price * 100)`.
 *
 * Matching is EXACT (never fuzzy): the booked service string matches a playbook
 * service by `id` OR by case-insensitive, trimmed `name`. Anything that does not
 * resolve to a real positive price returns `null` (NOT 0): no playbook, empty
 * services, no exact match, an unpriced service (`price` undefined), a non-finite
 * price, or a non-positive price. `null` means "no honest value", so callers leave
 * the estimate absent rather than recording a fabricated zero.
 */
export function resolveBookedValueCents(input: ResolveBookedValueInput): number | null {
  const { service, services } = input;
  if (!services || services.length === 0) return null; // no playbook / no services
  const target = normalize(service);
  const match = services.find((s) => s.id === service || normalize(s.name) === target);
  if (!match) return null; // the booked service is not in the playbook (exact id/name)
  const price = match.price;
  if (price === undefined) return null; // service present but unpriced
  // Number.isFinite-guard BEFORE any comparison (NaN-blind-gate lesson): a NaN or
  // +/-Infinity price must abstain, never propagate to NaN cents.
  if (!Number.isFinite(price)) return null;
  if (price <= 0) return null; // never record a 0 or negative value
  return Math.round(price * 100); // dollars (major units) -> cents
}

/** The org-playbook services lookup the calendar-book tool injects (undefined when no lookup is wired). */
export type GetServicesForOrg = (orgId: string) => Promise<readonly PlaybookService[] | undefined>;

/**
 * Best-effort booked-service value (cents) from the org playbook. Abstains to null
 * when no lookup is wired, the service is unmatched/unpriced, OR the playbook read
 * throws: valuing a booking must NEVER block it. Co-located with the pure resolver
 * it wraps; the calendar-book tool calls this before persisting a booking.
 */
export async function resolveBookedValueForBooking(
  getServicesForOrg: GetServicesForOrg | undefined,
  service: string,
  orgId: string,
): Promise<number | null> {
  if (!getServicesForOrg) return null;
  try {
    return resolveBookedValueCents({ service, services: await getServicesForOrg(orgId) });
  } catch (err) {
    console.warn("[calendar-book] playbook value lookup failed; booked value abstains", err);
    return null;
  }
}
