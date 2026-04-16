"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface LandingNavProps {
  isAuthenticated: boolean;
}

const NAV_LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

export function LandingNav({ isAuthenticated }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header>
      <nav
        aria-label="Main navigation"
        className={cn(
          "fixed left-0 right-0 top-0 z-50 transition-all",
          scrolled
            ? "bg-[hsl(45_25%_98%/0.95)] shadow-sm backdrop-blur-sm border-b border-[hsl(35_12%_89%)]"
            : "bg-transparent",
        )}
        style={{ transitionDuration: "300ms" }}
      >
        <div className="page-width flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="font-display text-xl font-medium tracking-tight"
            style={{ color: "hsl(30 8% 10%)" }}
          >
            Switchboard
          </Link>

          {/* Desktop nav links */}
          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-medium transition-colors"
                style={{
                  color: pathname === href ? "hsl(30 8% 10%)" : "hsl(30 6% 48%)",
                }}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Desktop right actions */}
          <div className="hidden items-center gap-4 md:flex">
            {isAuthenticated ? (
              <Link
                href="/me"
                className="text-sm font-medium transition-colors"
                style={{ color: "hsl(30 6% 48%)" }}
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="text-sm font-medium transition-colors"
                style={{ color: "hsl(30 6% 48%)" }}
              >
                Sign in
              </Link>
            )}
            <Link
              href="/get-started"
              className="rounded-full px-5 py-2 text-sm font-medium transition-all"
              style={{
                background: "hsl(30 55% 46%)",
                color: "white",
              }}
            >
              Get early access
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="flex items-center justify-center rounded-lg p-2 md:hidden"
            style={{ color: "hsl(30 8% 30%)" }}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {menuOpen ? (
                <path
                  d="M4 4l12 12M4 16L16 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              ) : (
                <>
                  <line
                    x1="3"
                    y1="6"
                    x2="17"
                    y2="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1="3"
                    y1="10"
                    x2="17"
                    y2="10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1="3"
                    y1="14"
                    x2="17"
                    y2="14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div
            className="border-t md:hidden"
            style={{
              background: "hsl(45 25% 98%)",
              borderColor: "hsl(35 12% 89%)",
            }}
          >
            <div className="page-width flex flex-col gap-1 py-4">
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
                  style={{ color: "hsl(30 6% 35%)" }}
                >
                  {label}
                </Link>
              ))}
              <div className="my-2 h-px" style={{ background: "hsl(35 12% 89%)" }} />
              {isAuthenticated ? (
                <Link
                  href="/me"
                  className="rounded-lg px-3 py-2.5 text-sm font-medium"
                  style={{ color: "hsl(30 6% 40%)" }}
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-2.5 text-sm font-medium"
                  style={{ color: "hsl(30 6% 40%)" }}
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/get-started"
                className="mt-1 rounded-full px-4 py-3 text-center text-sm font-medium"
                style={{ background: "hsl(30 55% 46%)", color: "white" }}
              >
                Get early access
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
