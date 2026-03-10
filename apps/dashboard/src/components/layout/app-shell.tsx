"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Shell } from "./shell";
import { DevPanel } from "../dev/dev-panel";
import { useOrgConfig } from "@/hooks/use-org-config";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];

// Pages that need full-viewport treatment (no content-width wrapper or padding)
const FULL_VIEWPORT_PATHS = ["/"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const isFullViewport = FULL_VIEWPORT_PATHS.includes(pathname);

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(!hideChrome);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;
  const isSetupPath = pathname === "/setup" || pathname.startsWith("/setup/");
  const isLoginPath = pathname === "/login";

  useEffect(() => {
    if (!orgLoading && !onboardingComplete && !isSetupPath && !isLoginPath) {
      router.replace("/setup");
    }
  }, [orgLoading, onboardingComplete, isSetupPath, isLoginPath, router]);

  if (hideChrome) {
    return (
      <main className="min-h-screen bg-background">
        {children}
        <DevPanel />
      </main>
    );
  }

  if (isFullViewport) {
    return (
      <div className="min-h-screen bg-background">
        <Shell />
        <main className="pb-20 md:pb-0 md:pt-14 min-h-[calc(100vh-56px)]">
          {children}
        </main>
        <DevPanel />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Shell />
      <main className="pb-20 md:pb-0 md:pt-14">
        <div className="page-width py-10 md:py-14">{children}</div>
      </main>
      <DevPanel />
    </div>
  );
}
