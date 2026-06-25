import type { ObserveGovernanceConfigInput } from "@switchboard/schemas";

/**
 * Derive the governance seed context (jurisdiction + clinicType) for a real org.
 *
 * OrganizationConfig stores no jurisdiction/clinicType field; the only proxy is
 * businessHours.timezone (often unset at provisioning). A Malaysian timezone maps
 * to "MY"; everything else defaults to "SG". clinicType has no signal, so it
 * defaults to "medical" (the stricter posture). In observe mode these values only
 * label telemetry and select the static rule list, so a defaulted value cannot
 * affect a live reply. Capturing the real values at onboarding is a follow-up.
 */
export function deriveAlexGovernanceSeedContext(
  orgConfig: { businessHours?: unknown } | null | undefined,
): ObserveGovernanceConfigInput {
  const timezone = readTimezone(orgConfig?.businessHours);
  const jurisdiction = timezone?.includes("Kuala_Lumpur") ? "MY" : "SG";
  return { jurisdiction, clinicType: "medical" };
}

function readTimezone(businessHours: unknown): string | undefined {
  if (typeof businessHours !== "object" || businessHours === null) return undefined;
  const tz = (businessHours as Record<string, unknown>)["timezone"];
  return typeof tz === "string" ? tz : undefined;
}
