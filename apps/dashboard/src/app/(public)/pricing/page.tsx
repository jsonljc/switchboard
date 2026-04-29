import type { Metadata } from "next";
import Link from "next/link";
import { LandingChrome } from "@/components/landing/landing-chrome";

export const metadata: Metadata = {
  title: "Pricing — Switchboard",
  description:
    "Agents start free. As they prove themselves, they unlock more autonomy — and you only pay for what's working.",
};

const TIERS = [
  {
    name: "Starter",
    price: "$49",
    period: "per month",
    threshold: "Start here",
    thresholdScore: null,
    autonomy: "Supervised",
    autonomyDesc: "Every action reviewed by you",
    capabilities: [
      "1 AI operator",
      "500 conversations / month",
      "All channels (WhatsApp, Telegram, web)",
      "Full audit trail",
    ],
    cta: "Get Started",
    ctaHref: "/signup",
    dark: false,
    highlight: false,
    accent: "#C8C3BC",
  },
  {
    name: "Pro",
    price: "$149",
    period: "per month",
    threshold: "Most businesses start here",
    thresholdScore: null,
    autonomy: "Semi-supervised",
    autonomyDesc: "Routine tasks run independently",
    capabilities: [
      "3 AI operators",
      "5,000 conversations / month",
      "Custom playbooks",
      "Advanced analytics",
      "Priority support",
    ],
    cta: "Get Started",
    ctaHref: "/signup",
    dark: false,
    highlight: true,
    accent: "#A07850",
  },
  {
    name: "Scale",
    price: "$399",
    period: "per month",
    threshold: "For growing teams",
    thresholdScore: null,
    autonomy: "Autonomous",
    autonomyDesc: "Operates independently within scope",
    capabilities: [
      "Unlimited operators",
      "Unlimited conversations",
      "Custom integrations",
      "Dedicated support",
      "Team management",
    ],
    cta: "Get Started",
    ctaHref: "/signup",
    dark: true,
    highlight: false,
    accent: "#C4986A",
  },
];

const FAQ = [
  {
    q: "Can I change plans?",
    a: "Yes. You can upgrade or downgrade at any time. Changes take effect on your next billing cycle.",
  },
  {
    q: "How does the performance score work?",
    a: "Performance is calculated from real task completions: tasks handled correctly, approvals received, exceptions flagged, and consistency over time. The more reliably it performs, the higher its score.",
  },
  {
    q: "Do I need a credit card to start?",
    a: "No. Sign up and start with a free trial. You only pay when you're ready.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. No lock-in, no long-term contracts. Cancel from your billing settings at any time.",
  },
];

export default function PricingPage() {
  return (
    <LandingChrome>
      {/* ── Hero ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "8rem", paddingBottom: "4rem" }}>
        <div className="page-width">
          <p
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#9C958F",
            }}
          >
            Pricing
          </p>
          <h1
            style={{
              fontSize: "clamp(2.8rem, 5.5vw, 5rem)",
              fontWeight: 700,
              letterSpacing: "-0.028em",
              lineHeight: 1.02,
              color: "#1A1714",
              maxWidth: "14ch",
            }}
          >
            Pricing that grows with trust.
          </h1>
          <p
            style={{
              marginTop: "1.5rem",
              fontSize: "1.125rem",
              lineHeight: 1.6,
              color: "#6B6560",
              maxWidth: "48ch",
            }}
          >
            Agents start free. As they prove themselves, they unlock more autonomy — and you only
            pay for what&rsquo;s working.
          </p>
        </div>
      </section>

      {/* ── Tier cards ── */}
      <section style={{ background: "#F5F3F0", paddingBottom: "5rem" }}>
        <div className="page-width">
          {/* Progress label */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "2rem",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "#DDD9D3" }} />
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#9C958F",
                whiteSpace: "nowrap",
              }}
            >
              performance unlocks each stage →
            </span>
            <div style={{ flex: 1, height: "1px", background: "#DDD9D3" }} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {TIERS.map(
              ({
                name,
                price,
                period,
                threshold,
                thresholdScore,
                autonomy,
                autonomyDesc,
                capabilities,
                cta,
                ctaHref,
                dark,
                highlight,
                accent,
              }) => (
                <div
                  key={name}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    borderRadius: "1rem",
                    padding: "1.5rem",
                    background: dark ? "#1E1C1A" : "#F9F8F6",
                    border: `1.5px solid ${highlight ? "#C8C3BC" : dark ? "#2E2B28" : "#DDD9D3"}`,
                    boxShadow: highlight ? "0 4px 20px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {highlight && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-0.75rem",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#1A1714",
                        color: "#F5F3F0",
                        borderRadius: "9999px",
                        padding: "0.2rem 0.875rem",
                        fontSize: "0.625rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Recommended
                    </div>
                  )}

                  {/* Trust threshold */}
                  <div
                    style={{
                      marginBottom: "1.25rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.625rem",
                    }}
                  >
                    <div
                      style={{
                        width: "2rem",
                        height: "2rem",
                        borderRadius: "9999px",
                        background: `${accent}20`,
                        border: `1.5px solid ${accent}40`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: accent,
                        flexShrink: 0,
                      }}
                    >
                      {thresholdScore !== null ? (
                        thresholdScore
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M2 5l2 2 4-4"
                            stroke={accent}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: accent }}>
                      {threshold}
                    </span>
                  </div>

                  {/* Name + price */}
                  <h3
                    style={{
                      fontSize: "1.375rem",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: dark ? "#EDE8E1" : "#1A1714",
                      marginBottom: "0.375rem",
                    }}
                  >
                    {name}
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.375rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "2rem",
                        fontWeight: 700,
                        letterSpacing: "-0.03em",
                        color: dark ? "#EDE8E1" : "#1A1714",
                      }}
                    >
                      {price}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: dark ? "#7A736C" : "#9C958F" }}>
                      {period}
                    </span>
                  </div>

                  {/* Autonomy block */}
                  <div
                    style={{
                      borderRadius: "0.5rem",
                      padding: "0.75rem",
                      background: dark ? "rgba(255,255,255,0.05)" : "#EDEAE5",
                      marginBottom: "1.25rem",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: accent,
                      }}
                    >
                      {autonomy}
                    </p>
                    <p
                      style={{
                        marginTop: "0.25rem",
                        fontSize: "0.75rem",
                        color: dark ? "#7A736C" : "#9C958F",
                      }}
                    >
                      {autonomyDesc}
                    </p>
                  </div>

                  {/* Capabilities */}
                  <ul
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      marginBottom: "1.5rem",
                      padding: 0,
                      listStyle: "none",
                    }}
                  >
                    {capabilities.map((cap) => (
                      <li
                        key={cap}
                        style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}
                      >
                        <div
                          style={{
                            width: "1rem",
                            height: "1rem",
                            borderRadius: "9999px",
                            background: `${accent}18`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: "0.1rem",
                          }}
                        >
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <path
                              d="M1.5 4l1.5 1.5 3.5-3.5"
                              stroke={accent}
                              strokeWidth="1.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <span
                          style={{
                            fontSize: "0.8125rem",
                            color: dark ? "#7A736C" : "#6B6560",
                            lineHeight: 1.4,
                          }}
                        >
                          {cap}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link
                    href={ctaHref}
                    style={{
                      display: "block",
                      borderRadius: "9999px",
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      ...(highlight || dark
                        ? { background: "#1A1714", color: "#F5F3F0" }
                        : {
                            background: "transparent",
                            border: "1px solid #DDD9D3",
                            color: "#1A1714",
                          }),
                    }}
                  >
                    {cta}
                  </Link>
                </div>
              ),
            )}
          </div>

          <p
            style={{
              marginTop: "1rem",
              textAlign: "center",
              fontSize: "0.75rem",
              color: "#9C958F",
            }}
          >
            Start with guided onboarding. Expand channels and workflows as your team goes live.
          </p>
        </div>
      </section>

      {/* ── Differentiator strip ── */}
      <section
        style={{
          background: "#EDEAE5",
          borderTop: "1px solid #DDD9D3",
          paddingTop: "4rem",
          paddingBottom: "4rem",
        }}
      >
        <div className="page-width" style={{ maxWidth: "42rem", margin: "0 auto" }}>
          <p
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              color: "#1A1714",
              lineHeight: 1.55,
              marginBottom: "1rem",
            }}
          >
            &ldquo;Unlike per-seat or per-call pricing, you pay more when your agent earns it.
            Agents that underperform stay on free.&rdquo;
          </p>
          <p style={{ fontSize: "0.9375rem", color: "#6B6560", lineHeight: 1.6 }}>
            Start free, monitor performance, and upgrade only when the agent has demonstrated it can
            handle more on its own.
          </p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width" style={{ maxWidth: "42rem" }}>
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "3rem",
            }}
          >
            Common questions.
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
            {FAQ.map(({ q, a }) => (
              <div key={q} style={{ borderBottom: "1px solid #DDD9D3", paddingBottom: "2.5rem" }}>
                <h3
                  style={{
                    fontSize: "1.0625rem",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    color: "#1A1714",
                    marginBottom: "0.625rem",
                  }}
                >
                  {q}
                </h3>
                <p style={{ fontSize: "0.9375rem", lineHeight: 1.65, color: "#6B6560" }}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section style={{ background: "#EDEAE5", paddingTop: "4rem", paddingBottom: "4rem" }}>
        <div className="page-width">
          <Link
            href="/signup"
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#1A1714",
              color: "#F5F3F0",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get Started →
          </Link>
        </div>
      </section>
    </LandingChrome>
  );
}
