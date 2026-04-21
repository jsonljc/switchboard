"use client";

import { usePathname } from "next/navigation";
import { OwnerTabs } from "@/components/layout/owner-tabs";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";

  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20">
        <div
          key={pathname}
          className={`${isDashboard ? "py-6" : "content-width py-6"} animate-fade-in`}
        >
          {children}
        </div>
      </main>
      <OwnerTabs />
    </div>
  );
}
