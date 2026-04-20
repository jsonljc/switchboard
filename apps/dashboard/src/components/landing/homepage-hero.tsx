import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { HeroCardCluster } from "@/components/landing/hero-card-cluster";

interface PreviewAgent {
  name: string;
  description: string;
  trustScore: number;
  slug: string;
}

interface HomepageHeroProps {
  previewAgents: PreviewAgent[];
}

export function HomepageHero({ previewAgents }: HomepageHeroProps) {
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
          <FadeIn>
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
                Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website.
                They qualify leads, book calls, and earn your trust over time.
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
          </FadeIn>

          {/* ── Right column: card cluster (desktop only) ── */}
          <div className="hidden md:flex" style={{ justifyContent: "flex-end" }}>
            <HeroCardCluster agents={previewAgents} />
          </div>
        </div>
      </div>
    </section>
  );
}
