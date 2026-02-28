"use client";

import { usePathname } from "next/navigation";
import { Header } from "./header";
import { NavBar } from "./nav-bar";
import { DevPanel } from "../dev/dev-panel";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

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
        <div className="max-w-4xl mx-auto p-4">{children}</div>
      </main>
      <DevPanel />
    </div>
  );
}
