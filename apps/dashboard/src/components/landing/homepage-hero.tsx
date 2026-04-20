"use client";

import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { ConversationDemo } from "@/components/landing/conversation-demo";

export function HomepageHero() {
  return (
    <section style={{ background: "#F5F3F0", minHeight: "92vh" }}>
      <div
        className="page-width"
        style={{
          minHeight: "92vh",
          paddingTop: "8rem",
          paddingBottom: "5rem",
        }}
      >
        {/* Label above the grid so it doesn't offset headline vs phone */}
        <FadeIn>
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
            AI booking agents for service businesses
          </p>
        </FadeIn>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "3rem",
            alignItems: "start",
            width: "100%",
          }}
          className="md:grid-cols-[1fr_auto] md:gap-16 lg:gap-24"
        >
          {/* Left column — headline + copy + CTAs */}
          <FadeIn>
            <div>
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
                Never miss
                <br />a lead again.
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
                Reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or
                your website.
              </p>
              <p
                style={{
                  marginTop: "0.375rem",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "#6B6560",
                  fontStyle: "italic",
                }}
              >
                While you sleep.
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
                <a
                  href="#conversation-demo"
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
                  See Alex in action →
                </a>
                <Link
                  href="/how-it-works"
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "#6B6560",
                    textDecoration: "none",
                  }}
                >
                  How it works
                </Link>
              </div>

              <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#9C958F" }}>
                Setup in minutes. Starts supervised. Stays in your control.
              </p>
            </div>
          </FadeIn>

          {/* Right column: conversation demo — top-aligned with h1 */}
          <div id="conversation-demo" className="flex justify-center md:justify-end">
            <ConversationDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
