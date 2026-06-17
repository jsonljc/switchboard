import type { PlaybookService } from "@switchboard/schemas";
import { getMetrics } from "../../telemetry/metrics.js";

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

/**
 * The outcome of a booked-value resolution, for the `bookedValueResolution`
 * observability metric. `resolved` populated a real positive value; every other
 * outcome ABSTAINS (valueCents null) for a distinct reason, which is the whole
 * point of the metric: it separates "org has no playbook" (operational) from
 * "playbook present but the booked service did not match" (the catalog-alignment
 * effectiveness signal) from "matched but unpriced". The first four are decided
 * synchronously by `classifyBookedValue`; `no_lookup` and `read_error` are added
 * by the async wrapper (no services lookup wired / the playbook read threw).
 */
export type BookedValueOutcome =
  | "resolved"
  | "no_playbook"
  | "no_match"
  | "matched_unpriced"
  | "no_lookup"
  | "read_error";

/** The subset of outcomes decided purely from (service, services). */
export type SyncBookedValueOutcome = Exclude<BookedValueOutcome, "no_lookup" | "read_error">;

/**
 * Classify a (service, services) pair into the resolved value PLUS the reason it
 * resolved or abstained. Pure (no metrics import). `valueCents` DELEGATES to
 * `resolveBookedValueCents`, so the cents are single-sourced and the
 * never-fabricate contract is inherited verbatim; this function only adds an
 * explanatory outcome label for observability. The match predicate mirrors the
 * resolver's exact id-or-name rule (same `normalize`), and the alignment test
 * pins `outcome === "resolved"` <=> `valueCents !== null` so the label can never
 * drift in a way that would mislabel a populated value.
 */
export function classifyBookedValue(input: ResolveBookedValueInput): {
  valueCents: number | null;
  outcome: SyncBookedValueOutcome;
} {
  const { service, services } = input;
  const valueCents = resolveBookedValueCents(input);
  if (!services || services.length === 0) return { valueCents, outcome: "no_playbook" };
  const target = normalize(service);
  const matched = services.some((s) => s.id === service || normalize(s.name) === target);
  if (!matched) return { valueCents, outcome: "no_match" };
  return { valueCents, outcome: valueCents === null ? "matched_unpriced" : "resolved" };
}

/** The org-playbook services lookup the calendar-book tool injects (undefined when no lookup is wired). */
export type GetServicesForOrg = (orgId: string) => Promise<readonly PlaybookService[] | undefined>;

/**
 * Best-effort booked-service value (cents) from the org playbook. Abstains to null
 * when no lookup is wired, the service is unmatched/unpriced, OR the playbook read
 * throws: valuing a booking must NEVER block it. Co-located with the pure resolver
 * it wraps; the calendar-book tool calls this before persisting a booking.
 *
 * Emits the `bookedValueResolution` metric exactly once per call, labeled by the
 * resolution outcome (resolved / no_playbook / no_match / matched_unpriced /
 * no_lookup / read_error), so the prod match-vs-abstain rate is observable without
 * a credentialed walkthrough. Observability-only: the returned value is unchanged.
 */
export async function resolveBookedValueForBooking(
  getServicesForOrg: GetServicesForOrg | undefined,
  service: string,
  orgId: string,
): Promise<number | null> {
  if (!getServicesForOrg) {
    getMetrics().bookedValueResolution.inc({ orgId, outcome: "no_lookup" });
    return null;
  }
  let services: readonly PlaybookService[] | undefined;
  try {
    services = await getServicesForOrg(orgId);
  } catch (err) {
    console.warn("[calendar-book] playbook value lookup failed; booked value abstains", err);
    getMetrics().bookedValueResolution.inc({ orgId, outcome: "read_error" });
    return null;
  }
  const { valueCents, outcome } = classifyBookedValue({ service, services });
  getMetrics().bookedValueResolution.inc({ orgId, outcome });
  return valueCents;
}
