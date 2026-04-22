import type { Metadata } from "next";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { getListingBySlug } from "@/lib/demo-data";
import { AgentMark } from "@/components/character/agent-mark";

export const metadata: Metadata = {
  title: "Get early access — Switchboard",
  description: "We're onboarding businesses one by one. We review every request personally.",
};

export default async function GetStartedPage() {
  const agent = await getListingBySlug("speed-to-lead").catch(() => null);

  return (
    <section
      style={{
        background: "#F5F3F0",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingTop: "8rem",
        paddingBottom: "5rem",
      }}
    >
      <div className="page-width">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
          {/* ── Left: form ── */}
          <div>
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
              Early access
            </p>
            <h1
              style={{
                fontSize: "clamp(2.4rem, 4.5vw, 4rem)",
                fontWeight: 700,
                letterSpacing: "-0.028em",
                lineHeight: 1.02,
                color: "#1A1714",
                marginBottom: "1rem",
              }}
            >
              Get early access.
            </h1>
            <p
              style={{
                fontSize: "1.0625rem",
                lineHeight: 1.65,
                color: "#6B6560",
                maxWidth: "44ch",
                marginBottom: "2.5rem",
              }}
            >
              We&rsquo;re onboarding businesses one by one. We review every request personally and
              follow up with next steps. If signup is temporarily unavailable, we&rsquo;ll tell you
              instead of silently dropping the request.
            </p>

            <WaitlistForm />

            <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#9C958F" }}>
              Best for service businesses using chat, leads, or inbound sales.
            </p>
          </div>

          {/* ── Right: agent preview ── */}
          <div className="hidden lg:block">
            <div
              style={{
                background: "#F9F8F6",
                border: "1px solid #DDD9D3",
                borderRadius: "1.25rem",
                padding: "2rem",
              }}
            >
              {/* Character mark */}
              <div style={{ marginBottom: "1.5rem" }}>
                <AgentMark agent="alex" size="xl" />
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
                Featured agent
              </p>
              <h3
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#1A1714",
                  marginBottom: "0.625rem",
                }}
              >
                {agent?.name ?? "Speed-to-Lead"}
              </h3>
              <p
                style={{
                  fontSize: "0.9375rem",
                  lineHeight: 1.6,
                  color: "#6B6560",
                  marginBottom: "1.5rem",
                }}
              >
                {agent?.description ??
                  "Responds to every new lead in under 5 minutes. Qualifies, books, and follows up — so you never miss a prospect."}
              </p>

              {/* Trust score */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  marginBottom: "1.5rem",
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
                  {agent?.trustScore ?? 84}
                </div>
                <span style={{ fontSize: "0.875rem", color: "#9C958F" }}>trust score</span>
              </div>

              {/* Capabilities */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {[
                  "Responds to inbound leads in under 2 minutes",
                  "Qualifies intent, budget, and urgency",
                  "Routes warm leads to your calendar",
                ].map((cap) => (
                  <div
                    key={cap}
                    style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem" }}
                  >
                    <div
                      style={{
                        width: "1.125rem",
                        height: "1.125rem",
                        borderRadius: "9999px",
                        background: "rgba(160,120,80,0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "0.125rem",
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path
                          d="M1.5 4.5l2 2 3.5-3.5"
                          stroke="#A07850"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <span style={{ fontSize: "0.875rem", color: "#6B6560", lineHeight: 1.45 }}>
                      {cap}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
