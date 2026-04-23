"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getCtaHref, getCtaLabel } from "@/lib/launch-mode";

interface LandingNavProps {
  isAuthenticated: boolean;
}

const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

export function LandingNav({ isAuthenticated }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header>
      <nav
        aria-label="Main navigation"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          transition: "background 250ms ease, border-color 250ms ease",
          background: scrolled ? "rgba(249, 248, 246, 0.96)" : "transparent",
          borderBottom: scrolled ? "1px solid #DDD9D3" : "1px solid transparent",
          backdropFilter: scrolled ? "blur(8px)" : "none",
        }}
      >
        <div
          className="page-width"
          style={{
            display: "flex",
            height: "4rem",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Wordmark */}
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "1.125rem",
              letterSpacing: "-0.015em",
              color: "#1A1714",
              textDecoration: "none",
            }}
          >
            Switchboard
          </Link>

          {/* Desktop nav */}
          <div style={{ display: "none", alignItems: "center", gap: "2rem" }} className="md:flex">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: pathname === href ? "#1A1714" : "#6B6560",
                  textDecoration: "none",
                  transition: "color 150ms ease",
                }}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Desktop right actions */}
          <div
            style={{ display: "none", alignItems: "center", gap: "1.25rem" }}
            className="md:flex"
          >
            {isAuthenticated ? (
              <Link
                href="/me"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Sign in
              </Link>
            )}
            <Link
              href={getCtaHref()}
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "0.875rem",
                background: "#1A1714",
                color: "#F5F3F0",
                borderRadius: "9999px",
                padding: "0.5rem 1.25rem",
                textDecoration: "none",
                whiteSpace: "nowrap",
                transition: "background 150ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#2C2825";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#1A1714";
              }}
            >
              {getCtaLabel()}
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.5rem",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#1A1714",
            }}
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
            className="md:hidden"
            style={{
              background: "#F9F8F6",
              borderTop: "1px solid #DDD9D3",
            }}
          >
            <div
              className="page-width"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                padding: "1rem 0",
              }}
            >
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    color: "#1A1714",
                    textDecoration: "none",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "0.5rem",
                  }}
                >
                  {label}
                </Link>
              ))}
              <div style={{ height: "1px", background: "#DDD9D3", margin: "0.5rem 0.75rem" }} />
              {isAuthenticated ? (
                <Link
                  href="/me"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    color: "#6B6560",
                    textDecoration: "none",
                    padding: "0.625rem 0.75rem",
                  }}
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    color: "#6B6560",
                    textDecoration: "none",
                    padding: "0.625rem 0.75rem",
                  }}
                >
                  Sign in
                </Link>
              )}
              <Link
                href={getCtaHref()}
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  background: "#1A1714",
                  color: "#F5F3F0",
                  borderRadius: "9999px",
                  padding: "0.75rem 1rem",
                  textAlign: "center",
                  textDecoration: "none",
                  marginTop: "0.25rem",
                  transition: "background 150ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#2C2825";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#1A1714";
                }}
              >
                {getCtaLabel()}
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
