"use client";

import { StaffNav } from "@/components/layout/staff-nav";
import { StaffMobileMenu } from "@/components/layout/staff-mobile-menu";

export function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <StaffNav />
      <StaffMobileMenu />
      <main className="md:pt-14">
        <div className="page-width py-10 md:py-14">{children}</div>
      </main>
    </div>
  );
}
