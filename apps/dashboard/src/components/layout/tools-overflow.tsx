"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import styles from "./tools-overflow.module.css";

export const TOOLS_NAV_ITEMS = [
  { id: "contacts", label: "Contacts", href: "/contacts" },
  { id: "automations", label: "Automations", href: "/automations" },
  { id: "activity", label: "Activity", href: "/activity" },
  { id: "reports", label: "Reports", href: "/reports" },
] as const;

export const TOOLS_PREFIXES = TOOLS_NAV_ITEMS.map((it) => it.href);

export type ToolsNavId = (typeof TOOLS_NAV_ITEMS)[number]["id"];

export function getToolsRouteAvailability(): Record<ToolsNavId, boolean> {
  return {
    contacts: process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true",
    automations: process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true",
    activity: process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true",
    reports: process.env.NEXT_PUBLIC_REPORTS_LIVE === "true",
  };
}

export function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ToolsOverflow() {
  const pathname = usePathname() ?? "";
  const availability = getToolsRouteAvailability();
  const visibleItems = TOOLS_NAV_ITEMS.filter((it) => availability[it.id]);

  // Hide the entire trigger when zero Tools routes are live (decision §2 row 11).
  if (visibleItems.length === 0) return null;

  const isToolsRoute = TOOLS_PREFIXES.some((p) => isPathActive(pathname, p));
  const settingsActive = isPathActive(pathname, "/settings");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={styles.trigger} data-on-tools={isToolsRoute || undefined}>
        Tools ▾
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent className={styles.menu} sideOffset={6} align="end">
          {visibleItems.map((it) => {
            const active = isPathActive(pathname, it.href);
            return (
              <DropdownMenuItem key={it.id} asChild data-active={active || undefined}>
                <Link href={it.href} aria-current={active ? "page" : undefined}>
                  {it.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild data-active={settingsActive || undefined}>
            <Link href="/settings" aria-current={settingsActive ? "page" : undefined}>
              Settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
