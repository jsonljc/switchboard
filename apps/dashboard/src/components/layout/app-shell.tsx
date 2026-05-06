"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOrgConfig } from "@/hooks/use-org-config";
import { OwnerShell } from "@/components/layout/owner-shell";

const DevPanel =
  process.env.NODE_ENV === "production"
    ? () => null
    : dynamic(() => import("../dev/dev-panel").then((mod) => mod.DevPanel), { ssr: false });

export const CHROME_HIDDEN_PATHS = [
  "/login",
  "/onboarding",
  "/setup",
  "/reports",
  "/operator/reports",
];

/**
 * Routes that mount their own EditorialAuthShell. These bypass both OwnerShell
 * and the legacy CHROME_HIDDEN <main> wrapper so the editorial shell can own
 * the page's `<main>` and chrome itself. /alex and /riley match the agent home
 * route; "/" is the Owner Home placeholder. Mira is intentionally absent —
 * /mira returns notFound().
 */
const EDITORIAL_SHELL_PATHS = new Set(["/", "/alex", "/riley"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const usesEditorialShell = EDITORIAL_SHELL_PATHS.has(pathname);

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(!hideChrome && !usesEditorialShell);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;
  const isSetupPath = pathname === "/setup" || pathname.startsWith("/setup/");
  const isLoginPath = pathname === "/login";

  useEffect(() => {
    if (!usesEditorialShell && !orgLoading && !onboardingComplete && !isSetupPath && !isLoginPath) {
      router.replace("/onboarding");
    }
  }, [usesEditorialShell, orgLoading, onboardingComplete, isSetupPath, isLoginPath, router]);

  if (usesEditorialShell) {
    return (
      <>
        {children}
        <DevPanel />
      </>
    );
  }

  if (hideChrome) {
    return (
      <main className="min-h-screen bg-background">
        {children}
        <DevPanel />
      </main>
    );
  }

  return (
    <>
      <OwnerShell>{children}</OwnerShell>
      <DevPanel />
    </>
  );
}
