"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DevPanel } from "../dev/dev-panel";
import { useOrgConfig } from "@/hooks/use-org-config";
import { OwnerShell } from "@/components/layout/owner-shell";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(!hideChrome);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;
  const isSetupPath = pathname === "/setup" || pathname.startsWith("/setup/");
  const isLoginPath = pathname === "/login";

  useEffect(() => {
    if (!orgLoading && !onboardingComplete && !isSetupPath && !isLoginPath) {
      router.replace("/onboarding");
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

  return (
    <>
      <OwnerShell>{children}</OwnerShell>
      <DevPanel />
    </>
  );
}
