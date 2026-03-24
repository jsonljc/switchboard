"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DevPanel } from "../dev/dev-panel";
import { useOrgConfig } from "@/hooks/use-org-config";
import { useViewPreference } from "@/hooks/use-view-preference";
import { OwnerShell } from "@/components/layout/owner-shell";
import { StaffShell } from "@/components/layout/staff-shell";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { view } = useViewPreference();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

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

  const Shell = view === "owner" ? OwnerShell : StaffShell;

  return (
    <>
      <Shell>{children}</Shell>
      <DevPanel />
    </>
  );
}
