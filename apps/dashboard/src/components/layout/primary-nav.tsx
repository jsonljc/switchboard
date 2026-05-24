"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { label: "Home", href: "/" },
  { label: "Inbox", href: "/inbox" },
  { label: "Results", href: "/results" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function PrimaryNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="primary-nav" aria-label="Primary">
      {ITEMS.map((item) => (
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
