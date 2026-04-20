import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getListingBySlug } from "@/lib/demo-data";
import { AgentMark, SLUG_TO_AGENT } from "@/components/character/agent-mark";
import { AGENT_CONTENT, FALLBACK_CONTENT } from "./agent-content.js";

// ── Trust tier lookup ──

function trustTierLabel(priceTier: string): { name: string; desc: string; score: string } {
  switch (priceTier) {
    case "basic":
      return { name: "Basic", desc: "Routine tasks run independently", score: "40+" };
    case "pro":
      return { name: "Pro", desc: "Operates independently within scope", score: "70+" };
    case "elite":
      return { name: "Elite", desc: "Humans step in only on exception", score: "90+" };
    default:
      return { name: "Free", desc: "Every action reviewed by you", score: "—" };
  }
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(slug).catch(() => null);
  if (!listing) return { title: "Agent Not Found — Switchboard" };
  return {
    title: `${listing.name} — Switchboard`,
    description: listing.description,
  };
}

export default async function AgentProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug).catch(() => null);
  if (!listing) notFound();

  const content = AGENT_CONTENT[slug] ?? FALLBACK_CONTENT;
  const agentId = SLUG_TO_AGENT[slug] ?? "alex";
  const tier = trustTierLabel(listing.priceTier);

  return (
    <div style={{ background: "#F5F3F0" }}>
      {/* ── Header ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "7rem", paddingBottom: "4rem" }}>
        <div className="page-width" style={{ maxWidth: "56rem", margin: "0 auto" }}>
          <Link
            href="/agents"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8125rem",
              color: "#9C958F",
              textDecoration: "none",
              marginBottom: "2.5rem",
            }}
          >
            ← All agents
          </Link>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "2rem",
            }}
            className="md:flex-row md:items-center"
          >
            <div style={{ flexShrink: 0 }}>
              <AgentMark agent={agentId} size="lg" />
            </div>

            <div style={{ flex: 1 }}>
              {/* Category chip */}
              <span
                style={{
                  display: "inline-block",
                  marginBottom: "0.75rem",
                  borderRadius: "9999px",
                  padding: "0.2rem 0.75rem",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  background: "rgba(160,120,80,0.1)",
                  color: "#A07850",
                }}
              >
                {listing.taskCategories[0] ?? "Sales"}
              </span>

              <h1
                style={{
                  fontSize: "clamp(2.2rem, 4vw, 3.6rem)",
                  fontWeight: 700,
                  lineHeight: 1.02,
                  letterSpacing: "-0.028em",
                  color: "#1A1714",
                }}
              >
                {listing.name}
              </h1>

              <p
                style={{
                  marginTop: "0.75rem",
                  fontSize: "1rem",
                  lineHeight: 1.65,
                  color: "#6B6560",
                  maxWidth: "52ch",
                }}
              >
                {content.tagline}
              </p>

              <div
                style={{
                  marginTop: "1.5rem",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                <Link
                  href="/get-started"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    borderRadius: "9999px",
                    padding: "0.75rem 1.75rem",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    background: "#1A1714",
                    color: "#F5F3F0",
                  }}
                >
                  Get early access
                </Link>

                {/* Trust score badge */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div
                    style={{
                      width: "2rem",
                      height: "2rem",
                      borderRadius: "9999px",
                      background: "rgba(160,120,80,0.1)",
                      border: "1.5px solid rgba(160,120,80,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "#A07850",
                    }}
                  >
                    {listing.trustScore}
                  </div>
                  <span style={{ fontSize: "0.8125rem", color: "#9C958F" }}>trust score</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section
        style={{
          background: "#EDEAE5",
          borderTop: "1px solid #DDD9D3",
          paddingTop: "4rem",
          paddingBottom: "4rem",
        }}
      >
        <div className="page-width" style={{ maxWidth: "56rem", margin: "0 auto" }}>
          <p
            style={{
              marginBottom: "0.5rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#A07850",
            }}
          >
            What it does
          </p>
          <h2
            style={{
              marginBottom: "2.5rem",
              fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
            }}
          >
            Built for one job.
          </h2>

          <ul
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(1, 1fr)",
              gap: "1rem",
              listStyle: "none",
              padding: 0,
            }}
            className="sm:grid-cols-2"
          >
            {content.capabilities.map((cap) => (
              <li
                key={cap}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  borderRadius: "0.75rem",
                  padding: "1.25rem",
                  background: "#F9F8F6",
                  border: "1px solid #DDD9D3",
                }}
              >
                <span
                  style={{
                    marginTop: "0.125rem",
                    flexShrink: 0,
                    display: "flex",
                    width: "1.25rem",
                    height: "1.25rem",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "9999px",
                    background: "rgba(160,120,80,0.1)",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2 5l2 2 4-4"
                      stroke="#A07850"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "#6B6560" }}>
                  {cap}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width" style={{ maxWidth: "56rem", margin: "0 auto" }}>
          <p
            style={{
              marginBottom: "0.5rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#A07850",
            }}
          >
            How it works
          </p>
          <h2
            style={{
              marginBottom: "3.5rem",
              fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
            }}
          >
            Simple from day one.
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "3rem" }}>
            {content.howItWorks.map(({ step, label, body }) => (
              <div key={step} style={{ display: "flex", gap: "1.5rem" }} className="md:gap-10">
                <span
                  style={{
                    fontSize: "4rem",
                    fontWeight: 700,
                    lineHeight: 1,
                    color: "#DDD9D3",
                    letterSpacing: "-0.04em",
                    flexShrink: 0,
                    width: "3.5rem",
                  }}
                >
                  {step}
                </span>
                <div style={{ paddingTop: "0.25rem" }}>
                  <h3
                    style={{
                      marginBottom: "0.5rem",
                      fontSize: "1.25rem",
                      fontWeight: 700,
                      letterSpacing: "-0.015em",
                      color: "#1A1714",
                    }}
                  >
                    {label}
                  </h3>
                  <p
                    style={{
                      fontSize: "0.9375rem",
                      lineHeight: 1.65,
                      color: "#6B6560",
                      maxWidth: "52ch",
                    }}
                  >
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust & Pricing ── */}
      <section
        style={{
          background: "#EDEAE5",
          borderTop: "1px solid #DDD9D3",
          borderBottom: "1px solid #DDD9D3",
          paddingTop: "4rem",
          paddingBottom: "4rem",
        }}
      >
        <div className="page-width" style={{ maxWidth: "56rem", margin: "0 auto" }}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "2rem" }}
            className="md:flex-row md:items-start md:gap-16"
          >
            <div style={{ flex: 1 }}>
              <p
                style={{
                  marginBottom: "0.5rem",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#A07850",
                }}
              >
                Trust & pricing
              </p>
              <h2
                style={{
                  marginBottom: "1rem",
                  fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
                  fontWeight: 700,
                  letterSpacing: "-0.025em",
                  color: "#1A1714",
                }}
              >
                Starts free.
                <br />
                Earns its way up.
              </h2>
              <p
                style={{
                  marginBottom: "1.5rem",
                  fontSize: "0.9375rem",
                  lineHeight: 1.65,
                  color: "#6B6560",
                  maxWidth: "44ch",
                }}
              >
                {content.trustNote}
              </p>
              <Link
                href="/pricing"
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#A07850",
                  textDecoration: "none",
                }}
              >
                See full pricing →
              </Link>
            </div>

            {/* Current tier card */}
            <div
              style={{
                borderRadius: "1rem",
                padding: "1.5rem",
                background: "#F9F8F6",
                border: "1.5px solid #DDD9D3",
                minWidth: "14rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  marginBottom: "0.75rem",
                }}
              >
                <div
                  style={{
                    width: "2.25rem",
                    height: "2.25rem",
                    borderRadius: "9999px",
                    background: "rgba(160,120,80,0.1)",
                    border: "1.5px solid rgba(160,120,80,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    color: "#A07850",
                  }}
                >
                  {tier.score}
                </div>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#A07850" }}>
                  Current tier
                </span>
              </div>
              <p
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#1A1714",
                }}
              >
                {tier.name}
              </p>
              <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "#9C958F" }}>
                {tier.desc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Channels ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "4rem", paddingBottom: "4rem" }}>
        <div className="page-width" style={{ maxWidth: "56rem", margin: "0 auto" }}>
          <p
            style={{
              marginBottom: "0.5rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#A07850",
            }}
          >
            Channels
          </p>
          <h2
            style={{
              marginBottom: "2rem",
              fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
            }}
          >
            Works where your customers are.
          </h2>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {content.channels.map(({ name, icon }) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  borderRadius: "9999px",
                  padding: "0.625rem 1.25rem",
                  background: "#F9F8F6",
                  border: "1px solid #DDD9D3",
                }}
              >
                <span style={{ fontSize: "1rem" }}>{icon}</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1A1714" }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        style={{
          background: "#EDEAE5",
          borderTop: "1px solid #DDD9D3",
          paddingTop: "5rem",
          paddingBottom: "5rem",
        }}
      >
        <div className="page-width" style={{ maxWidth: "42rem" }}>
          <h2
            style={{
              marginBottom: "3rem",
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
            }}
          >
            Common questions.
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
            {content.faq.map(({ q, a }) => (
              <div key={q} style={{ borderBottom: "1px solid #DDD9D3", paddingBottom: "2.5rem" }}>
                <h3
                  style={{
                    marginBottom: "0.625rem",
                    fontSize: "1.0625rem",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    color: "#1A1714",
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
      <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width">
          <p
            style={{
              marginBottom: "1.5rem",
              fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
            }}
          >
            Ready to put {listing.name} to work?
          </p>
          <Link
            href="/get-started"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
              background: "#1A1714",
              color: "#F5F3F0",
            }}
          >
            Get early access →
          </Link>
        </div>
      </section>
    </div>
  );
}
