"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOrgConfig } from "@/hooks/use-org-config";

const DevPanel =
  process.env.NODE_ENV === "production"
    ? () => null
    : dynamic(() => import("../dev/dev-panel").then((mod) => mod.DevPanel), { ssr: false });

/**
 * Routes that mount their own EditorialAuthShell. The editorial shell owns
 * the page's <main> and chrome itself. /alex and /riley match the agent home
 * route; "/" is the Owner Home placeholder. Mira is intentionally absent —
 * /mira returns notFound().
 */
const EDITORIAL_SHELL_PATHS = new Set(["/", "/alex", "/riley"]);

/**
 * Visual decision: routes that own their own page chrome (no AppShell wrapping).
 * Includes Mercury Tools surfaces (/contacts, /automations, /reports), the
 * settings hub (/settings/* — its layout owns its sidebar), the onboarding/auth
 * flow, and the operator/reports admin surface.
 */
export const CHROME_HIDDEN_PATHS = [
  "/login",
  "/onboarding",
  "/setup",
  "/contacts",
  "/automations",
  "/reports",
  "/settings",
  "/operator/reports",
];

/**
 * Gating decision: routes where the onboarding-completeness check should NOT
 * fire. Intentionally narrower than CHROME_HIDDEN_PATHS — most chrome-hidden
 * routes (Mercury surfaces, /settings, /operator/reports) still need
 * onboarding to be complete. Only the auth/setup flow itself is exempt.
 *
 * Editorial paths (/, /alex, /riley) are also exempt by their own branch
 * below (existing behavior preserved).
 *
 * Reviewer flips (per spec §5.4):
 *   - To preserve the implicit /reports exemption that existed pre-D4+D5,
 *     add "/reports" here.
 *   - To exempt /operator for support/debugging, add "/operator" here.
 *   - To gate editorial paths too, remove the usesEditorialShell check
 *     from shouldCheckOnboarding below.
 */
export const ONBOARDING_EXEMPT_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const usesEditorialShell = EDITORIAL_SHELL_PATHS.has(pathname);
  const isOnboardingExempt = ONBOARDING_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const shouldCheckOnboarding = !usesEditorialShell && !isOnboardingExempt;
  const { data: orgData, isLoading: orgLoading } = useOrgConfig(shouldCheckOnboarding);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;

  useEffect(() => {
    if (shouldCheckOnboarding && !orgLoading && !onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [shouldCheckOnboarding, orgLoading, onboardingComplete, router]);

  if (usesEditorialShell) {
    return (
      <>
        {children}
        <DevPanel />
      </>
    );
  }

  // All non-editorial routes (Mercury surfaces, /settings, /operator/reports,
  // /login, /onboarding, /setup) get the bare <main> wrapper. The route's
  // own layout.tsx (e.g., SettingsLayout, ReportsLayout) is responsible for
  // any sidebar/header/back-link chrome.
  return (
    <main className="min-h-screen bg-background">
      {children}
      <DevPanel />
    </main>
  );
}
