"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function HomepageHero() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  const s = (delay: number) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(14px)",
    transition: `opacity 0.75s ease, transform 0.75s ease`,
    transitionDelay: `${delay}ms`,
  });

  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: "hsl(45 25% 98%)",
        minHeight: "92vh",
      }}
    >
      {/* Warm radial wash — top right */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 75% 15%, hsl(38 70% 91%) 0%, transparent 65%)",
        }}
      />

      {/* Abstract SVG illustration — connection nodes */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 hidden xl:block"
        style={{ width: 580, height: 580 }}
      >
        <svg viewBox="0 0 580 580" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Soft background circles */}
          <circle cx="370" cy="210" r="200" fill="hsl(30 55% 46% / 0.04)" />
          <circle cx="460" cy="130" r="140" fill="hsl(38 65% 88% / 0.55)" />
          <ellipse cx="440" cy="290" rx="180" ry="110" fill="hsl(38 55% 92% / 0.7)" />
          <circle
            cx="300"
            cy="320"
            r="260"
            stroke="hsl(30 40% 70% / 0.1)"
            strokeWidth="0.75"
            fill="none"
          />

          {/* Connection lines */}
          <line
            x1="180"
            y1="160"
            x2="370"
            y2="210"
            stroke="hsl(30 45% 60% / 0.18)"
            strokeWidth="0.75"
            strokeDasharray="4 6"
          />
          <line
            x1="370"
            y1="210"
            x2="460"
            y2="130"
            stroke="hsl(30 45% 60% / 0.18)"
            strokeWidth="0.75"
            strokeDasharray="4 6"
          />
          <line
            x1="460"
            y1="130"
            x2="510"
            y2="260"
            stroke="hsl(30 45% 60% / 0.15)"
            strokeWidth="0.75"
            strokeDasharray="4 6"
          />
          <line
            x1="370"
            y1="210"
            x2="440"
            y2="340"
            stroke="hsl(30 45% 60% / 0.12)"
            strokeWidth="0.75"
            strokeDasharray="4 6"
          />

          {/* Nodes */}
          <circle cx="180" cy="160" r="5" fill="hsl(30 55% 46% / 0.25)" />
          <circle cx="370" cy="210" r="8" fill="hsl(30 55% 46% / 0.18)" />
          <circle cx="460" cy="130" r="6" fill="hsl(30 55% 46% / 0.22)" />
          <circle cx="510" cy="260" r="4" fill="hsl(30 45% 60% / 0.2)" />
          <circle cx="440" cy="340" r="5" fill="hsl(30 45% 60% / 0.18)" />

          {/* Inner glow on main node */}
          <circle cx="370" cy="210" r="18" fill="hsl(30 55% 46% / 0.07)" />
          <circle cx="370" cy="210" r="32" fill="hsl(30 55% 46% / 0.04)" />
        </svg>
      </div>

      {/* Content */}
      <div
        className="page-width relative z-10 flex flex-col justify-center"
        style={{ minHeight: "92vh", paddingTop: "7rem", paddingBottom: "5rem" }}
      >
        <div style={{ maxWidth: 640 }}>
          {/* Eyebrow */}
          <div className="mb-8 inline-flex items-center gap-2.5" style={s(80)}>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: "hsl(30 55% 46%)",
                boxShadow: "0 0 0 3px hsl(30 55% 46% / 0.2)",
                animation: "pulse 2.4s ease-in-out infinite",
              }}
            />
            <span
              className="text-xs font-medium uppercase tracking-widest"
              style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
            >
              AI Agent Marketplace
            </span>
          </div>

          {/* Headline — the centrepiece */}
          <h1
            className="font-display"
            style={{
              fontSize: "clamp(3.2rem, 6.5vw, 6.2rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
              fontWeight: 300,
              color: "hsl(30 8% 10%)",
              ...s(180),
            }}
          >
            Your AI sales team,
            <br />
            <em
              style={{
                fontStyle: "italic",
                fontWeight: 300,
                color: "hsl(30 48% 40%)",
              }}
            >
              ready in minutes.
            </em>
          </h1>

          {/* Subhead */}
          <p
            className="mt-8 text-lg leading-relaxed"
            style={{
              color: "hsl(30 6% 40%)",
              maxWidth: 500,
              ...s(320),
            }}
          >
            Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website. They
            qualify leads, book calls, and earn your trust over time.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex items-center gap-5" style={s(460)}>
            <Link
              href="/get-started"
              className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-medium tracking-wide"
              style={{
                background: "hsl(30 55% 46%)",
                color: "white",
                transition: "opacity 0.18s ease, transform 0.18s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.opacity = "0.9";
                (e.currentTarget as HTMLElement).style.transform = "scale(1.025)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.opacity = "1";
                (e.currentTarget as HTMLElement).style.transform = "scale(1)";
              }}
            >
              Get early access
            </Link>
            <Link
              href="/agents"
              className="text-sm font-medium transition-colors"
              style={{ color: "hsl(30 6% 50%)" }}
            >
              Browse agents →
            </Link>
          </div>

          {/* Social proof */}
          <p
            className="mt-8 text-xs"
            style={{
              color: "hsl(30 5% 62%)",
              ...s(640),
            }}
          >
            Join 200+ businesses on the early access list
          </p>
        </div>
      </div>
    </section>
  );
}
