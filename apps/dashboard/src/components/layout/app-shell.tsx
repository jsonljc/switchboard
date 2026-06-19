"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DataModeBanner } from "@/components/layout/data-mode-banner";
import { VerifyEmailBanner } from "@/components/layout/verify-email-banner";
import { EditorialAuthShellInner } from "@/components/layout/editorial-auth-shell";
import { useOrgConfig } from "@/hooks/use-org-config";

// DevPanel always dynamic-loads (ssr: false). The runtime `dataModeControlsAllowed`
// check inside DevPanel itself is the authoritative gate — no build-time stubbing.
// Earlier versions short-circuited on `NODE_ENV === "production"` to avoid loading
// the chunk in prod builds, but that also disabled the panel on Vercel preview
// deployments (which run NODE_ENV=production), defeating the purpose of fixture-
// mode opt-in for staging walkthroughs.
const DevPanel = dynamic(() => import("../dev/dev-panel").then((mod) => mod.DevPanel), {
  ssr: false,
});

/**
 * Chrome-free paths render WITHOUT the editorial app-header. The onboarding
 * flow owns a full-bleed, distraction-free experience and must never surface
 * the app chrome. /operator is internal staff tooling — it manages its own
 * page-level header and must not receive the customer nav shell. Every other
 * authed route inherits the one shared editorial shell mounted below.
 *
 * Note: /login is a top-level route (app/login/page.tsx) that never reaches
 * AppShell, so it does not need an entry here. It is kept in
 * ONBOARDING_EXEMPT_PATHS below only for the onboarding-gate bypass.
 *
 * Prefix matches use the canonical `pathname === p || pathname.startsWith(p + "/")`
 * shape so /onboarding/step-2 stays chrome-free while /onboardingx does not.
 */
const CHROME_FREE_PATHS = ["/onboarding", "/operator"];

function isChromeFree(pathname: string): boolean {
  return CHROME_FREE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Paths exempt from the onboarding-completeness gate. Narrower than the
 * chrome-free set — Mercury surfaces, /settings, /operator/* still redirect
 * to /onboarding when the org is incomplete. The /mira cockpit bypasses because
 * it is always reachable post-auth. "/" (Home) is NOT exempt — an authenticated
 * but not-yet-onboarded user landing on Home is redirected to /onboarding so they
 * complete setup before accessing any content. (/alex and /riley were retired;
 * they now redirect to Home's ?agent= deep-link, which is gated like any "/".)
 */
export const ONBOARDING_GATE_EXEMPT_EXACT = new Set(["/mira", "/mira/review"]);
export const ONBOARDING_EXEMPT_PATHS = ["/login", "/onboarding"];

export function AppShell({
  children,
  dataModeControlsAllowed = false,
}: {
  children: React.ReactNode;
  dataModeControlsAllowed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const chromeFree = isChromeFree(pathname);
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

  // Chrome-free flows (onboarding, login) render full-bleed: no app-header and
  // no editorial <main> wrapper. The page owns its own layout. DataModeBanner +
  // DevPanel still mount so demo-mode and the dev panel work everywhere.
  if (chromeFree) {
    return (
      <>
        <DataModeBanner />
        <VerifyEmailBanner />
        {children}
        <DevPanel dataModeControlsAllowed={dataModeControlsAllowed} />
      </>
    );
  }

  // Every other authed route shares ONE editorial shell. EditorialAuthShellInner
  // mounts HaltProvider + RightDrawerProvider + AmbientCream + EditorialKeys + the
  // app-header and wraps children in <main>. The EditorialShellBoundary now lives
  // INSIDE the shell, scoped to the content slot, so a page render error keeps the
  // header + nav mounted instead of stranding the user (a root-layout / chrome
  // error still falls through to app/error.tsx). DataModeBanner sits above the
  // sticky header (matching its non-sticky contract); DevPanel mounts after.
  return (
    <>
      <DataModeBanner />
      <VerifyEmailBanner />
      <EditorialAuthShellInner>{children}</EditorialAuthShellInner>
      <DevPanel dataModeControlsAllowed={dataModeControlsAllowed} />
    </>
  );
}
