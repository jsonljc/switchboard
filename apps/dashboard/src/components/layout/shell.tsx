"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  TrendingUp,
  ShieldCheck,
  Users,
  LineChart,
  MessageSquare,
  BarChart3,
  Inbox,
  Bot,
  BookOpen,
  MessagesSquare,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useInboxCount } from "@/hooks/use-inbox";
import { useOrgConfig } from "@/hooks/use-org-config";

const NAV = [
  { href: "/mission", label: "Today", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Chats", icon: MessageSquare },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/campaigns", label: "Campaigns", icon: BarChart3 },
  { href: "/results", label: "Results", icon: TrendingUp },
  { href: "/growth", label: "Growth", icon: LineChart },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/test-chat", label: "Test Chat", icon: MessagesSquare },
  { href: "/escalations", label: "Escalations", icon: AlertTriangle },
  { href: "/approvals", label: "Decide", icon: ShieldCheck },
];

export function Shell() {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const inboxCount = useInboxCount();
  const { data: orgData } = useOrgConfig();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Desktop: minimal top bar */}
      <header className="hidden md:block fixed top-0 left-0 right-0 z-40 h-14 border-b border-border/50 bg-background/92 backdrop-blur-sm">
        <div className="page-width h-full flex items-center justify-between gap-12">
          {/* Logo — links to identity page */}
          <Link
            href="/mission"
            className="text-[14px] font-medium text-foreground tracking-tight shrink-0 hover:text-muted-foreground transition-colors duration-fast"
          >
            Switchboard
          </Link>

          {/* Nav — text only, underline active state */}
          <nav className="flex items-center gap-0 flex-1 justify-center">
            {NAV.map((item) => {
              const active = isActive(item.href);
              const count =
                (item.href === "/approvals" && pendingCount > 0 ? pendingCount : null) ??
                (item.href === "/inbox" && inboxCount > 0 ? inboxCount : null);

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
                  {/* Underline indicator */}
                  {active && (
                    <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-foreground rounded-full" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right: org name + sign out */}
          <div className="flex items-center gap-3 shrink-0">
            {orgData?.config?.name && (
              <span className="text-[12px] text-muted-foreground/70 truncate max-w-[140px]">
                {orgData.config.name}
              </span>
            )}
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

      {/* Mobile: bottom tab bar — icons retained for tap targets */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-around h-full px-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[44px] text-[10px] tracking-wide transition-colors duration-fast",
                  active ? "text-foreground font-medium" : "text-muted-foreground",
                )}
              >
                <div className="relative">
                  <Icon className="h-[18px] w-[18px]" />
                  {item.href === "/approvals" && pendingCount > 0 && (
                    <span className="absolute -top-0.5 -right-1 text-[9px] font-medium text-muted-foreground">
                      {pendingCount}
                    </span>
                  )}
                  {item.href === "/inbox" && inboxCount > 0 && (
                    <span className="absolute -top-0.5 -right-1 text-[9px] font-medium text-muted-foreground">
                      {inboxCount}
                    </span>
                  )}
                </div>
                <span>{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
