"use client";

import { OwnerTabs } from "./owner-tabs.js";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20">
        <div className="content-width py-6">{children}</div>
      </main>
      <OwnerTabs />
    </div>
  );
}
