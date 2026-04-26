"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, BookOpen, Radio, Palette, Building2, CreditCard, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const stripeEnabled = process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";

const ALL_SIDEBAR_ITEMS = [
  { href: "/settings/playbook", label: "Your Playbook", icon: BookOpen },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/settings/channels", label: "Channels", icon: Radio },
  { href: "/settings/website-leads", label: "Website leads", icon: Globe },
  { href: "/settings/identity", label: "Identity", icon: Palette },
  { href: "/settings/billing", label: "Billing", icon: CreditCard, requiresStripe: true },
  { href: "/settings/account", label: "Account", icon: Building2 },
] as const;

type SidebarItem = (typeof ALL_SIDEBAR_ITEMS)[number];

function getVisibleItems(): readonly SidebarItem[] {
  if (stripeEnabled) return ALL_SIDEBAR_ITEMS;
  return ALL_SIDEBAR_ITEMS.filter((item) => !("requiresStripe" in item && item.requiresStripe));
}

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sidebarItems = getVisibleItems();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex gap-10 min-h-[calc(100vh-120px)]">
      <aside className="hidden md:block w-[200px] shrink-0">
        <h2 className="text-[22px] font-semibold tracking-tight text-foreground mb-6">Settings</h2>
        <nav className="space-y-0.5">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors duration-fast",
                  active
                    ? "text-foreground font-medium bg-surface"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface/50",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="md:hidden">
          {pathname === "/settings" ? (
            <div className="space-y-1">
              <h2 className="text-[22px] font-semibold tracking-tight text-foreground mb-6">
                Settings
              </h2>
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface transition-colors"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ) : (
            <div>
              <Link
                href="/settings"
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-4 inline-block"
              >
                ← Settings
              </Link>
              {children}
            </div>
          )}
        </div>

        <div className="hidden md:block">{children}</div>
      </div>
    </div>
  );
}
