"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useOrgConfig } from "@/hooks/use-org-config";

const NAV = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/crm", label: "CRM" },
  { href: "/performance", label: "Performance" },
  { href: "/decide", label: "Decide" },
] as const;

export function StaffNav() {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const { data: orgData } = useOrgConfig();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="hidden md:block fixed top-0 left-0 right-0 z-40 h-14 border-b border-border/50 bg-background/92 backdrop-blur-sm">
      <div className="page-width h-full flex items-center justify-between gap-8">
        <Link
          href="/"
          className="text-[14px] font-medium text-foreground tracking-tight shrink-0 hover:text-muted-foreground transition-colors duration-fast"
        >
          Switchboard
        </Link>

        <nav className="flex items-center gap-0 flex-1 justify-center">
          {NAV.map((item) => {
            const active = isActive(item.href, "exact" in item ? item.exact : false);
            const count = item.href === "/decide" && pendingCount > 0 ? pendingCount : null;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-4 py-4 text-[13.5px] tracking-[0.01em] transition-colors duration-fast whitespace-nowrap",
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {count !== null && (
                  <span className="ml-1.5 text-muted-foreground font-normal">· {count}</span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-foreground rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {orgData?.config?.name && (
            <span className="text-[12px] text-muted-foreground/70 truncate max-w-[140px]">
              {orgData.config.name}
            </span>
          )}
          <Link
            href="/settings"
            className={cn(
              "p-2 rounded-lg transition-colors duration-fast",
              pathname.startsWith("/settings")
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-fast py-1"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
