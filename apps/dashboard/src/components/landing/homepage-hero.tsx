import Link from "next/link";
import { AgentMark } from "@/components/character/agent-mark";

interface PreviewAgent {
  name: string;
  description: string;
  trustScore: number;
  slug: string;
}

interface HomepageHeroProps {
  previewAgent?: PreviewAgent | null;
}

export function HomepageHero({ previewAgent }: HomepageHeroProps) {
  return (
    <section style={{ background: "#F5F3F0", minHeight: "92vh" }}>
      <div
        className="page-width"
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: "92vh",
          paddingTop: "8rem",
          paddingBottom: "5rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "3rem",
            alignItems: "center",
            width: "100%",
          }}
          className="md:grid-cols-[1fr_auto] md:gap-16 lg:gap-24"
        >
          {/* ── Left column ── */}
          <div>
            <p
              style={{
                marginBottom: "1.5rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C958F",
              }}
            >
              AI Agent Marketplace
            </p>

            <h1
              style={{
                fontSize: "clamp(3rem, 5.5vw, 5.5rem)",
                fontWeight: 700,
                lineHeight: 1.02,
                letterSpacing: "-0.028em",
                color: "#1A1714",
                margin: 0,
              }}
            >
              Your AI sales team.
              <br />
              Ready in minutes.
            </h1>

            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "1.125rem",
                lineHeight: 1.6,
                color: "#6B6560",
                maxWidth: "44ch",
              }}
            >
              Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website. They
              qualify leads, book calls, and earn your trust over time.
            </p>

            <div
              style={{
                marginTop: "2.5rem",
                display: "flex",
                alignItems: "center",
                gap: "1.5rem",
                flexWrap: "wrap",
              }}
            >
              <Link
                href="/get-started"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: "#1A1714",
                  color: "#F5F3F0",
                  borderRadius: "9999px",
                  padding: "0.875rem 1.75rem",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Get early access
              </Link>
              <Link
                href="/agents"
                style={{
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Browse agents →
              </Link>
            </div>

            <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#9C958F" }}>
              Join 200+ businesses on the early access list
            </p>
          </div>

          {/* ── Right column: agent card preview (desktop only) ── */}
          <div className="hidden md:flex" style={{ justifyContent: "flex-end" }}>
            <div
              style={{
                width: "17rem",
                background: "#F9F8F6",
                border: "1px solid #DDD9D3",
                borderRadius: "1.25rem",
                padding: "1.75rem",
                flexShrink: 0,
              }}
            >
              {/* Character mark */}
              <div
                style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1.25rem" }}
              >
                <AgentMark agent="alex" size="lg" />
              </div>

              {/* Agent info */}
              <p
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#9C958F",
                  marginBottom: "0.375rem",
                }}
              >
                Lead Qualifier
              </p>
              <h3
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  letterSpacing: "-0.015em",
                  color: "#1A1714",
                  margin: 0,
                }}
              >
                {previewAgent?.name ?? "Speed-to-Lead"}
              </h3>
              <p
                style={{
                  marginTop: "0.625rem",
                  fontSize: "0.8125rem",
                  lineHeight: 1.55,
                  color: "#6B6560",
                }}
              >
                {previewAgent?.description ??
                  "Responds to every new lead in under 5 minutes. Qualifies, books, and follows up — so you never miss a prospect."}
              </p>

              {/* Trust score */}
              <div
                style={{
                  marginTop: "1.25rem",
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
                  {previewAgent?.trustScore ?? 84}
                </div>
                <span style={{ fontSize: "0.8125rem", color: "#9C958F" }}>trust score</span>
              </div>

              {/* Capabilities */}
              <div
                style={{
                  marginTop: "1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {[
                  "Responds in under 5 minutes",
                  "Qualifies leads automatically",
                  "Books calls to your calendar",
                ].map((cap) => (
                  <div
                    key={cap}
                    style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}
                  >
                    <div
                      style={{
                        width: "1rem",
                        height: "1rem",
                        borderRadius: "9999px",
                        background: "rgba(160,120,80,0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "0.125rem",
                      }}
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path
                          d="M1.5 4l2 2 3-3"
                          stroke="#A07850"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <span style={{ fontSize: "0.8125rem", color: "#6B6560", lineHeight: 1.4 }}>
                      {cap}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <Link
                href="/agents/speed-to-lead"
                style={{
                  display: "block",
                  marginTop: "1.5rem",
                  padding: "0.625rem 1rem",
                  background: "#EDEAE5",
                  border: "1px solid #DDD9D3",
                  borderRadius: "9999px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "#1A1714",
                  textAlign: "center",
                  textDecoration: "none",
                }}
              >
                Learn more →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
