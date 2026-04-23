import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { AgentMark } from "@/components/character/agent-mark";
import { FaqAccordion } from "./faq-accordion";
import { getCtaHref } from "@/lib/launch-mode";

const FEATURES = [
  "Instant lead response",
  "Lead qualification and booking flow",
  "WhatsApp, Telegram, and web",
  "Approval-first controls",
  "Full audit trail",
  "Human handoff when needed",
];

const FAQ_ITEMS = [
  {
    question: "Do I need a credit card to get started?",
    answer:
      "We'll walk you through setup on a short call. No surprise charges — you'll know exactly what to expect before anything is billed.",
  },
  {
    question: "Will Alex act without my approval?",
    answer:
      "No. Alex can start in supervised mode, with approval required on every action. You decide when to loosen the controls.",
  },
  {
    question: "What happens as I trust it more?",
    answer:
      "You can choose to review less and let routine actions run faster, while keeping exceptions visible. You stay in control the whole time.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes. No lock-in, no long-term contracts.",
  },
];

export function PricingSection() {
  return (
    <section style={{ background: "#EDEAE5", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width" style={{ maxWidth: "42rem", margin: "0 auto" }}>
        <FadeIn>
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
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "0.75rem",
            }}
          >
            Simple pricing for your first booking agent.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "#6B6560",
              marginBottom: "3rem",
            }}
          >
            Launch Alex on the channels your customers already use. Stay in control from day one,
            then automate more as trust builds.
          </p>
        </FadeIn>

        {/* Alex pricing card */}
        <FadeIn delay={80}>
          <div
            style={{
              background: "#F9F8F6",
              border: "1px solid #DDD9D3",
              borderRadius: "1.25rem",
              padding: "2rem",
              boxShadow: "0 4px 16px rgba(26,23,20,0.06)",
            }}
          >
            {/* Agent identity */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginBottom: "1.5rem",
              }}
            >
              <AgentMark agent="alex" size="lg" />
              <h3
                style={{
                  marginTop: "0.75rem",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#1A1714",
                }}
              >
                Alex
              </h3>
              <p style={{ fontSize: "0.875rem", color: "#6B6560" }}>Your first booking agent</p>
            </div>

            {/* Price */}
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <span
                style={{
                  fontSize: "2.5rem",
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: "#1A1714",
                }}
              >
                $49
              </span>
              <span style={{ fontSize: "0.875rem", color: "#9C958F" }}>/month</span>
            </div>

            {/* Features */}
            <ul
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.625rem",
                padding: 0,
                listStyle: "none",
                marginBottom: "1.5rem",
              }}
            >
              {FEATURES.map((feature) => (
                <li
                  key={feature}
                  style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{ flexShrink: 0 }}
                  >
                    <circle cx="8" cy="8" r="7" fill="rgba(160,120,80,0.1)" />
                    <path
                      d="M5 8l2 2 4-4"
                      stroke="#A07850"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span style={{ fontSize: "0.875rem", color: "#1A1714" }}>{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <Link
              href={getCtaHref()}
              style={{
                display: "block",
                width: "100%",
                padding: "0.875rem",
                background: "#1A1714",
                color: "#F5F3F0",
                borderRadius: "9999px",
                fontSize: "0.9375rem",
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Get started →
            </Link>
          </div>
        </FadeIn>

        {/* Expansion link */}
        <p style={{ marginTop: "1.5rem", textAlign: "center" }}>
          <a
            href="mailto:hello@switchboard.ai"
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#A07850",
              textDecoration: "none",
            }}
          >
            Need higher volume, custom workflows, or multiple agents? → Talk to us
          </a>
        </p>

        {/* Supporting note */}
        <p
          style={{
            marginTop: "0.75rem",
            textAlign: "center",
            fontSize: "0.8125rem",
            color: "#9C958F",
          }}
        >
          No long setup project. No dev team required to get started.
        </p>

        {/* FAQ */}
        <div style={{ marginTop: "4rem" }}>
          <h3
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              color: "#1A1714",
              marginBottom: "1.5rem",
            }}
          >
            Common questions
          </h3>
          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </div>
    </section>
  );
}
