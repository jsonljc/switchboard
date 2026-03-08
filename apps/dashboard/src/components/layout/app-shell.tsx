"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "./header";
import { NavBar } from "./nav-bar";
import { DevPanel } from "../dev/dev-panel";
import { useOrgConfig } from "@/hooks/use-org-config";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(!hideChrome);

  // Redirect guard: if onboarding is not complete, redirect to /setup
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
      <main>
        {children}
        <DevPanel />
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />
      <NavBar />
      <main className="pb-20 md:pb-0 md:pl-60">
        <div className="max-w-5xl mx-auto p-4">{children}</div>
      </main>
      <DevPanel />
    </div>
  );
}
