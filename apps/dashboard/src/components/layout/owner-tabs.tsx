"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, Home, MessageSquare, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useEscalationCount } from "@/hooks/use-escalations";

const TABS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/conversations", label: "Chats", icon: MessageSquare },
  { href: "/escalations", label: "Escalations", icon: AlertCircle },
  { href: "/decide", label: "Decide", icon: ShieldCheck },
  { href: "/me", label: "Me", icon: User },
] as const;

export function OwnerTabs() {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const escalationCount = useEscalationCount();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-border/50 bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-around h-full">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-1/5 min-h-[44px] text-[10px] tracking-wide transition-colors duration-fast",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              <div className="relative">
                <Icon className="h-[20px] w-[20px]" />
                {tab.label === "Escalations" && escalationCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {escalationCount > 9 ? "9+" : escalationCount}
                  </span>
                )}
                {tab.href === "/decide" && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-2 text-[9px] font-medium text-foreground bg-caution/20 rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                    {pendingCount}
                  </span>
                )}
              </div>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
