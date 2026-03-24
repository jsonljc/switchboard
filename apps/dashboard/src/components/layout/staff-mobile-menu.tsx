"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useViewPreference } from "@/hooks/use-view-preference";

const MENU_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/crm", label: "CRM" },
  { href: "/performance", label: "Performance" },
  { href: "/decide", label: "Decide" },
] as const;

export function StaffMobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const { setView } = useViewPreference();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="md:hidden">
      <header className="fixed top-0 left-0 right-0 z-40 h-14 border-b border-border/50 bg-background/95 backdrop-blur-sm flex items-center justify-between px-4">
        <button
          onClick={() => setOpen(!open)}
          className="p-2 text-foreground"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="text-[14px] font-medium text-foreground tracking-tight">Switchboard</span>
        <div className="w-9" />
      </header>

      {open && (
        <div className="fixed inset-0 z-30 pt-14 bg-background">
          <nav className="px-6 py-8 space-y-1">
            {MENU_ITEMS.map((item) => {
              const active = isActive(item.href);
              const count = item.href === "/decide" && pendingCount > 0 ? pendingCount : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block px-4 py-3 rounded-lg text-[15px] transition-colors",
                    active
                      ? "text-foreground font-medium bg-surface"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  {count !== null && (
                    <span className="ml-2 text-muted-foreground font-normal">· {count}</span>
                  )}
                </Link>
              );
            })}

            <div className="border-t border-border/40 my-4" />

            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block px-4 py-3 rounded-lg text-[15px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Settings
            </Link>

            <button
              onClick={() => {
                setView("owner");
                setOpen(false);
              }}
              className="block w-full text-left px-4 py-3 rounded-lg text-[15px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Switch to Owner view
            </button>

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="block w-full text-left px-4 py-3 rounded-lg text-[15px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
