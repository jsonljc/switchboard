import type { Session } from "next-auth";

/**
 * Resolve the post-login destination based on session shape.
 * - No org → /onboarding (user hasn't been provisioned to a tenant yet)
 * - Org but onboarding incomplete → /onboarding (resume the wizard)
 * - Otherwise → /console (the operator's home at v1 launch)
 */
export function defaultCallback(session: Session | null): string {
  if (!session?.organizationId) return "/onboarding";
  const onboardingComplete = (session as Session & { onboardingComplete?: boolean })
    .onboardingComplete;
  if (!onboardingComplete) return "/onboarding";
  return "/console";
}
