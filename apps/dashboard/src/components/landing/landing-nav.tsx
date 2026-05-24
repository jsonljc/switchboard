"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface LandingNavProps {
  isAuthenticated: boolean;
}

export function LandingNav({ isAuthenticated }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
            href="/welcome"
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

          {/* Right action — auth-state dependent */}
          {isAuthenticated ? (
            <Link
              href="/settings/account"
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
        </div>
      </nav>
    </header>
  );
}
