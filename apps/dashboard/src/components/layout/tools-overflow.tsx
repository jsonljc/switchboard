"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isMercuryToolLive, type ToolsNavId } from "@/lib/route-availability";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import styles from "./tools-overflow.module.css";

export const TOOLS_NAV_ITEMS: ReadonlyArray<{
  readonly id: ToolsNavId;
  readonly label: string;
  readonly href: string;
}> = [
  { id: "contacts", label: "Pipeline", href: "/contacts" },
  { id: "automations", label: "Automations", href: "/automations" },
  { id: "reports", label: "Reports", href: "/results" },
];
// NOTE: "/activity" (the audit-ledger viewer) is intentionally absent from the
// operator nav. SMB clinic owners want bookings, not a forensic event log, so
// the surface is kept reachable by URL (and via the dev panel) for support/
// debugging but is not advertised in the Tools menu. The WorkTrace ledger and
// the /api/dashboard/activity read endpoint are untouched. "activity" remains a
// ToolsNavId (its NEXT_PUBLIC_ACTIVITY_LIVE flag still gates the page itself),
// mirroring how "approvals" stayed a ToolsNavId after PR #646 removed its nav.

export const TOOLS_PREFIXES = TOOLS_NAV_ITEMS.map((it) => it.href);

export type { ToolsNavId };

export function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ToolsOverflow() {
  const pathname = usePathname() ?? "";
  // poll:false — the header mounts on every authed page; enablement is static,
  // so don't add an app-wide 60s mission poll just to gate the Mira item.
  const { enabled: miraEnabled } = useMiraEnabled({ poll: false });
  const visibleItems = TOOLS_NAV_ITEMS.filter((it) => isMercuryToolLive(it.id));
  // The advanced operator surface rides the same flag as customer reports — no
  // separate env var (avoids the allowlist dance) and it only matters once
  // reports are live anyway.
  const advancedReportsLive = isMercuryToolLive("reports");

  // Hide the entire trigger only when there is nothing to show: no live Tools
  // routes AND Mira is not enabled for this org.
  if (visibleItems.length === 0 && !miraEnabled) return null;

  const miraActive = isPathActive(pathname, "/mira");
  const reportsAdvancedActive = isPathActive(pathname, "/reports");
  const isToolsRoute =
    TOOLS_PREFIXES.some((p) => isPathActive(pathname, p)) ||
    (miraEnabled && miraActive) ||
    (advancedReportsLive && reportsAdvancedActive);
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
          {miraEnabled && (
            <DropdownMenuItem asChild data-active={miraActive || undefined}>
              <Link href="/mira" aria-current={miraActive ? "page" : undefined}>
                Mira
              </Link>
            </DropdownMenuItem>
          )}
          {advancedReportsLive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Advanced</DropdownMenuLabel>
              <DropdownMenuItem asChild data-active={reportsAdvancedActive || undefined}>
                <Link href="/reports" aria-current={reportsAdvancedActive ? "page" : undefined}>
                  Full reports
                </Link>
              </DropdownMenuItem>
            </>
          )}
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
