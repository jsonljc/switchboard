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
 * Paths that mount their own EditorialAuthShell — either directly (agent
 * homes via /alex and /riley page.tsx) or via a route-group layout (Mercury
 * Tools surfaces via (mercury)/layout.tsx). AppShell skips its bare-<main> wrapper
 * for these so the page-owned <main> from EditorialAuthShell isn't nested.
 *
 * "/" is exact (Owner Home placeholder). Other entries are prefix matches so
 * /alex/setup, /contacts/[id], etc. all resolve to the editorial shell.
 * /mira is intentionally absent — /mira returns notFound().
 */
const SHELL_OWNED_EXACT = new Set(["/"]);
const SHELL_OWNED_PREFIXES = [
  "/alex",
  "/riley",
  "/contacts",
  "/automations",
  "/activity",
  "/reports",
];

function ownsItsShell(pathname: string): boolean {
  if (SHELL_OWNED_EXACT.has(pathname)) return true;
  return SHELL_OWNED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Paths exempt from the onboarding-completeness gate. Narrower than the
 * shell-ownership set — Mercury surfaces, /settings, /operator/* still
 * redirect to /onboarding when the org is incomplete. Only editorial agent
 * homes and the auth/setup flow bypass.
 */
const ONBOARDING_GATE_EXEMPT_EXACT = new Set(["/", "/alex", "/riley"]);
export const ONBOARDING_EXEMPT_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const usesEditorialShell = ownsItsShell(pathname);
  const isGateExempt = ONBOARDING_GATE_EXEMPT_EXACT.has(pathname);
  const isOnboardingExempt = ONBOARDING_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const shouldCheckOnboarding = !isGateExempt && !isOnboardingExempt;
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
