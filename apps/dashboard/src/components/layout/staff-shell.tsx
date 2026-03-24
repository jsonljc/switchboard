"use client";

import { usePathname } from "next/navigation";
import { StaffNav } from "@/components/layout/staff-nav";
import { StaffMobileMenu } from "@/components/layout/staff-mobile-menu";

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <StaffNav />
      <StaffMobileMenu />
      <main className="md:pt-14">
        <div key={pathname} className="page-width py-10 md:py-14 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
