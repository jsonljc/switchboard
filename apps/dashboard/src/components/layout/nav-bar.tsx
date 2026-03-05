"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Activity,
  ShieldCheck,
  FileText,
  FlaskConical,
  Box,
  Settings,
  Bell,
  Calendar,
  AlertTriangle,
  TrendingUp,
  Plug,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const primaryNavItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/simulate", label: "Simulate", icon: FlaskConical },
];

const secondaryNavItems = [
  { href: "/policies", label: "Policies", icon: FileText },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/scheduled-reports", label: "Reports", icon: Calendar },
  { href: "/dlq", label: "DLQ", icon: AlertTriangle },
  { href: "/competence", label: "Competence", icon: TrendingUp },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/cartridges", label: "Cartridges", icon: Box },
  { href: "/settings", label: "Settings", icon: Settings },
];

const allNavItems = [...primaryNavItems, ...secondaryNavItems];

export function NavBar() {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const [moreOpen, setMoreOpen] = useState(false);

  const isSecondaryActive = secondaryNavItems.some((item) => pathname.startsWith(item.href));

  return (
    <>
      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
        <div className="flex items-center justify-around h-16">
          {primaryNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[64px] min-h-[44px] text-xs transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {item.href === "/approvals" && pendingCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-destructive text-destructive-foreground text-[10px] rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 min-w-[64px] min-h-[44px] text-xs transition-colors",
              isSecondaryActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="h-auto max-h-[70vh]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <nav className="grid grid-cols-3 gap-2 pt-4 pb-6">
            {secondaryNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-lg text-xs transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:border-r md:bg-background md:fixed md:inset-y-0 md:z-40">
        <div className="flex items-center h-14 px-4 border-b">
          <Link href="/" className="font-semibold text-lg">
            Switchboard
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {allNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {item.href === "/approvals" && pendingCount > 0 && (
                  <span className="ml-auto bg-destructive text-destructive-foreground text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
