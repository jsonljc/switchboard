import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works — Switchboard",
  description:
    "Find the right agent, connect it to your channels, and let it earn autonomy through real performance.",
};

const ACTS = [
  {
    n: "01",
    label: "Browse",
    title: "Find the right agent for the job",
    copy: "Every agent is built around a specific business outcome — qualifying leads, booking calls, re-engaging cold contacts. Browse by outcome, not by feature list. Each one is designed for a specific job, so you're not buying potential — you're deploying a proven pattern.",
    visual: (
      <div
        style={{
          background: "#F9F8F6",
          border: "1px solid #DDD9D3",
          borderRadius: "1rem",
          padding: "1.5rem",
        }}
      >
        {[
          { name: "Alex", role: "Qualifies leads" },
          { name: "Sales Closer", role: "Books calls" },
          { name: "Nurture Specialist", role: "Re-engages contacts" },
        ].map(({ name, role }) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 1rem",
              background: "#F5F3F0",
              border: "1px solid #DDD9D3",
              borderRadius: "0.5rem",
              marginBottom: "0.5rem",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "#1A1714" }}>{name}</span>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#9C958F",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {role}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    n: "02",
    label: "Deploy",
    title: "Connect it to your channels in minutes",
    copy: "No code. Choose a channel, connect it to your account, and the agent is live. We handle the integration — you handle the business. Channels are where your customers already are.",
    visual: (
      <div
        style={{
          background: "#F9F8F6",
          border: "1px solid #DDD9D3",
          borderRadius: "1rem",
          padding: "1.5rem",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}
        >
          {["WhatsApp", "Telegram", "Web widget"].map((ch) => (
            <div
              key={ch}
              style={{
                flex: 1,
                padding: "0.75rem 0.5rem",
                background: "#F5F3F0",
                border: "1px solid #DDD9D3",
                borderRadius: "0.5rem",
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6B6560" }}>{ch}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0.625rem 1.25rem",
            background: "#1A1714",
            borderRadius: "9999px",
            width: "fit-content",
            margin: "0 auto",
          }}
        >
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#F5F3F0" }}>Go live</span>
        </div>
        <p
          style={{
            marginTop: "0.875rem",
            fontSize: "0.75rem",
            color: "#9C958F",
            textAlign: "center",
          }}
        >
          No code required — connect and launch in minutes
        </p>
      </div>
    ),
  },
  {
    n: "03",
    label: "Earn trust",
    title: "Earn trust. Earn autonomy.",
    copy: "Every agent starts supervised. It proves itself through real tasks — you review and approve its first actions. As its performance score climbs, it earns more operating freedom. You step in only when it flags something important. That's not compliance theater — it's what makes the system safe to scale.",
    visual: (
      <div
        style={{
          background: "#F9F8F6",
          border: "1px solid #DDD9D3",
          borderRadius: "1rem",
          padding: "1.5rem",
        }}
      >
        {[
          { label: "Starts supervised", score: "0", active: false },
          { label: "First tasks approved", score: "40", active: false },
          { label: "Earns autonomy", score: "70", active: false },
          { label: "Fully trusted", score: "90+", active: true },
        ].map(({ label, score, active }, i) => (
          <div
            key={score}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.875rem",
              marginBottom: i < 3 ? "0.75rem" : 0,
            }}
          >
            <div
              style={{
                width: "2.25rem",
                height: "2.25rem",
                borderRadius: "9999px",
                background: active ? "#1A1714" : "#EDEAE5",
                border: `1.5px solid ${active ? "#1A1714" : "#DDD9D3"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: active ? "#F5F3F0" : "#9C958F",
                flexShrink: 0,
              }}
            >
              {score}
            </div>
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: active ? 700 : 400,
                color: active ? "#1A1714" : "#6B6560",
              }}
            >
              {label}
            </span>
            {active && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#A07850",
                  background: "rgba(160,120,80,0.1)",
                  borderRadius: "9999px",
                  padding: "0.2rem 0.5rem",
                }}
              >
                Goal
              </span>
            )}
          </div>
        ))}
      </div>
    ),
  },
];

export default function HowItWorksPage() {
  return (
    <>
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
            How it works
          </p>
          <h1
            style={{
              fontSize: "clamp(2.8rem, 5.5vw, 5rem)",
              fontWeight: 700,
              letterSpacing: "-0.028em",
              lineHeight: 1.02,
              color: "#1A1714",
              maxWidth: "16ch",
            }}
          >
            From discovery to trusted automation.
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
            Find the right agent, connect it to your channels, and let it earn autonomy through real
            performance.
          </p>
        </div>
      </section>

      {/* ── 3 Acts ── */}
      <section style={{ background: "#F5F3F0", paddingBottom: "5rem" }}>
        <div
          className="page-width"
          style={{ display: "flex", flexDirection: "column", gap: "6rem" }}
        >
          {ACTS.map(({ n, label, title, copy, visual }, i) => (
            <div
              key={n}
              className="grid grid-cols-1 lg:grid-cols-2"
              style={{
                gap: "3rem",
                alignItems: "center",
                direction: i % 2 === 1 ? "rtl" : "ltr",
              }}
            >
              {/* Text */}
              <div style={{ direction: "ltr" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "1rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "5rem",
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: "-0.04em",
                      color: "#DDD9D3",
                      userSelect: "none",
                    }}
                  >
                    {n}
                  </span>
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "#A07850",
                      background: "rgba(160,120,80,0.1)",
                      borderRadius: "9999px",
                      padding: "0.25rem 0.75rem",
                    }}
                  >
                    {label}
                  </span>
                </div>
                <h2
                  style={{
                    fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "#1A1714",
                    marginBottom: "1rem",
                  }}
                >
                  {title}
                </h2>
                <p style={{ fontSize: "1rem", lineHeight: 1.65, color: "#6B6560" }}>{copy}</p>
              </div>

              {/* Visual */}
              <div style={{ direction: "ltr" }}>{visual}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Governance strip ── */}
      <section
        style={{
          background: "#EDEAE5",
          borderTop: "1px solid #DDD9D3",
          paddingTop: "4rem",
          paddingBottom: "4rem",
        }}
      >
        <div className="page-width" style={{ maxWidth: "42rem", margin: "0 auto" }}>
          <p style={{ fontSize: "0.9375rem", lineHeight: 1.7, color: "#6B6560" }}>
            Switchboard audits every action, tracks trust in real time, and puts humans back in
            control when it matters.{" "}
            <span style={{ color: "#1A1714", fontWeight: 600 }}>
              That&rsquo;s not compliance theater — it&rsquo;s what makes the system safe to scale.
            </span>
          </p>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div
          className="page-width"
          style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}
        >
          <Link
            href="/agents"
            style={{
              background: "#1A1714",
              color: "#F5F3F0",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Browse agents
          </Link>
          <Link
            href="/signup"
            style={{
              background: "transparent",
              border: "1px solid #DDD9D3",
              color: "#1A1714",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get Started
          </Link>
        </div>
      </section>
    </>
  );
}
