"use client";

import { usePathname } from "next/navigation";

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
  // Stub — JSX implementation lands in Task 3.
  // Wire usePathname() now so the import is resolved by typecheck.
  const _pathname = usePathname() ?? "";
  return null;
}
