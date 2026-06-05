"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";

const ITEMS = [
  { label: "Home", href: "/" },
  { label: "Inbox", href: "/inbox" },
  { label: "Results", href: "/results" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function PrimaryNav() {
  const pathname = usePathname() ?? "/";
  // On narrow viewports this nav is the only primary entry (the sidebar is
  // hidden at < lg), so Mira joins it when enabled: she is the one agent with
  // a route (IA decision, 2026-06-05 coherence audit).
  const { enabled: miraEnabled } = useMiraEnabled();
  const items: ReadonlyArray<{ label: string; href: string }> = miraEnabled
    ? [...ITEMS, { label: "Mira", href: "/mira" }]
    : ITEMS;
  return (
    <nav className="primary-nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className="primary-nav__item"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
