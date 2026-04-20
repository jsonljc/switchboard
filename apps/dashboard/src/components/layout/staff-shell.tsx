"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/my-agent", label: "My Agent" },
  { href: "/tasks", label: "Tasks" },
  { href: "/decide", label: "Decide" },
] as const;

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen bg-background">
      <header className="hidden md:block fixed top-0 left-0 right-0 z-40 h-14 border-b border-border/50 bg-background/92 backdrop-blur-sm">
        <div className="page-width h-full flex items-center justify-between gap-8">
          <Link
            href="/dashboard"
            className="text-[14px] font-medium text-foreground tracking-tight shrink-0 hover:text-muted-foreground transition-colors duration-fast"
          >
            Switchboard
          </Link>
          <nav className="flex items-center gap-0 flex-1 justify-center">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-4 py-4 text-[13.5px] tracking-[0.01em] transition-colors duration-fast whitespace-nowrap",
                  isActive(item.href)
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {item.label === "Decide" && pendingCount > 0 && (
                  <span className="absolute top-2.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
                {isActive(item.href) && (
                  <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-foreground rounded-full" />
                )}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/settings"
              className="p-2 rounded-lg transition-colors duration-fast text-muted-foreground hover:text-foreground"
              aria-label="Settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
          </div>
        </div>
      </header>
      <main className="md:pt-14">
        <div key={pathname} className="page-width py-10 md:py-14 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
