import { resolveConsentStateConfig } from "@switchboard/schemas";
import type { GovernanceMode } from "@switchboard/schemas";
import { getMetrics, type ContactConsentReader } from "@switchboard/core";
import type {
  ConsentPrecondition,
  GovernanceConfigResolver,
  GovernancePostureCache,
} from "@switchboard/core/skill-runtime";

export interface BookingConsentPreconditionDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  /**
   * The SAME consentState posture cache the PdpaConsentGateHook warms (it remembers
   * `mode = resolveConsentStateConfig(config).mode` keyed by deploymentId). On a
   * resolver error we read its last-known mode as the fail-closed fallback, so the
   * booking gate and the outbound consent gate can never disagree on a deployment's
   * mode.
   */
  consentPostureCache: GovernancePostureCache;
  contactConsentReader: ContactConsentReader;
}

/**
 * F15 + A19: builds the booking consent precondition adapter wired into the
 * calendar-book tool (bootstrap/skill-mode.ts).
 *
 * `resolveMode` maps the governance-config resolution to the booking gate's mode:
 *   - "resolved" -> resolveConsentStateConfig(config).mode  (off | observe | enforce)
 *   - "missing"  -> "off"   (no governance config => gate not enrolled => fully inert)
 *   - "error"    -> cache-driven fail-safe (the governance-config-resolver contract:
 *                   gates MUST treat "error" as a safe fallback, NOT as "off"). Returns
 *                   "enforce" only when the deployment has a warm "enforce" posture in
 *                   consentPostureCache, the same cache + rule the PdpaConsentGateHook
 *                   applies on its own resolver error. A cold cache returns "off" (nothing
 *                   proves this deployment enforces consent, so a transient store blip on a
 *                   never-observed deployment must not start blocking; this mirrors the
 *                   outbound gate's cold-cache fail-open). Emits bookingConsentResolverError.
 *
 * Pre-A19 this collapsed every non-"resolved" status to "off", silently disabling an
 * enrolled org's booking gate on a transient resolver error (P1-6).
 *
 * Extracted from bootstrap/skill-mode.ts so resolveMode is unit-testable in isolation
 * (the full bootstrap needs ANTHROPIC_API_KEY + a Prisma client). Stays dep-injected:
 * NO Prisma, NO env here.
 */
export function createBookingConsentPrecondition(
  deps: BookingConsentPreconditionDeps,
): ConsentPrecondition {
  const { governanceConfigResolver, consentPostureCache, contactConsentReader } = deps;
  return {
    resolveMode: async (deploymentId: string): Promise<GovernanceMode> => {
      const resolution = await governanceConfigResolver(deploymentId);
      if (resolution.status === "resolved") {
        return resolveConsentStateConfig(resolution.config).mode;
      }
      if (resolution.status === "missing") {
        return "off";
      }
      // resolution.status === "error": the governance-config store threw or the stored
      // config failed validation. Keep enforcing only when a warm "enforce" posture proves
      // this deployment enforces consent; otherwise fall open to "off".
      const failClosed = consentPostureCache.lastKnown(deploymentId)?.mode === "enforce";
      getMetrics().bookingConsentResolverError.inc({
        deploymentId,
        outcome: failClosed ? "enforce_from_cache" : "off_cold_cache",
      });
      if (failClosed) {
        console.error(
          `[booking-consent] governance config resolver error for deployment ${deploymentId}; failing closed to enforce from warm posture cache`,
        );
        return "enforce";
      }
      console.error(
        `[booking-consent] governance config resolver error for deployment ${deploymentId}; no warm enforce posture, falling open to off`,
      );
      return "off";
    },
    read: (orgId: string, contactId: string) => contactConsentReader.read(orgId, contactId),
  };
}
