import type { Metadata } from "next";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { getListingBySlug } from "@/lib/demo-data";
import { OperatorCharacter } from "@/components/character/operator-character";

export const metadata: Metadata = {
  title: "Get early access — Switchboard",
  description: "We're onboarding businesses one by one. We review every request personally.",
};

export default async function GetStartedPage() {
  // Show the Speed-to-Lead agent card as the right-panel visual
  const agent = await getListingBySlug("speed-to-lead").catch(() => null);

  return (
    <section
      className="flex min-h-screen flex-col justify-center py-32"
      style={{ background: "hsl(45 25% 98%)" }}
    >
      <div className="page-width">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
          {/* ── Left: form ── */}
          <div>
            <p
              className="mb-4 text-xs font-medium uppercase tracking-widest"
              style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
            >
              Early access
            </p>
            <h1
              className="mb-3 font-display font-light"
              style={{
                fontSize: "clamp(2.4rem, 4.5vw, 4rem)",
                letterSpacing: "-0.025em",
                lineHeight: 1.06,
                color: "hsl(30 8% 10%)",
              }}
            >
              Get early access.
            </h1>
            <p
              className="mb-10 text-base leading-relaxed"
              style={{ color: "hsl(30 5% 44%)", maxWidth: "44ch" }}
            >
              We&rsquo;re onboarding businesses one by one. We review every request personally and
              follow up with next steps.
            </p>

            <WaitlistForm />

            {/* Qualifier */}
            <p className="mt-8 text-xs" style={{ color: "hsl(30 5% 58%)" }}>
              Best for service businesses using chat, leads, or inbound sales.
            </p>
          </div>

          {/* ── Right: agent preview ── */}
          <div className="hidden lg:block">
            {agent ? (
              <div
                className="rounded-2xl p-8"
                style={{
                  background: "hsl(38 35% 96%)",
                  border: "1px solid hsl(35 18% 88%)",
                }}
              >
                {/* Character */}
                <div className="mb-6 flex justify-center">
                  <OperatorCharacter roleFocus="leads" />
                </div>

                {/* Agent info */}
                <div className="text-center">
                  <p
                    className="mb-1 text-xs font-medium uppercase tracking-widest"
                    style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.12em" }}
                  >
                    Featured agent
                  </p>
                  <h3
                    className="mb-2 font-display text-2xl font-light"
                    style={{ color: "hsl(30 8% 10%)", letterSpacing: "-0.01em" }}
                  >
                    {agent.name}
                  </h3>
                  <p
                    className="mb-6 text-sm leading-relaxed"
                    style={{ color: "hsl(30 5% 46%)", maxWidth: "32ch", margin: "0 auto 1.5rem" }}
                  >
                    {agent.description}
                  </p>

                  {/* Trust score */}
                  <div
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2"
                    style={{ background: "hsl(30 55% 46% / 0.1)" }}
                  >
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ background: "hsl(30 55% 46%)" }}
                    />
                    <span className="text-xs font-medium" style={{ color: "hsl(30 48% 38%)" }}>
                      Trust score: {agent.trustScore}/100
                    </span>
                  </div>
                </div>

                {/* Capabilities */}
                <div className="mt-6 space-y-2">
                  {[
                    "Responds to inbound leads in under 2 minutes",
                    "Qualifies intent, budget, and urgency",
                    "Routes warm leads to your calendar",
                  ].map((cap) => (
                    <div key={cap} className="flex items-center gap-2.5">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="hsl(30 55% 46%)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="text-xs" style={{ color: "hsl(30 5% 42%)" }}>
                        {cap}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Fallback if no DB data */
              <div
                className="rounded-2xl p-8 text-center"
                style={{
                  background: "hsl(38 35% 96%)",
                  border: "1px solid hsl(35 18% 88%)",
                }}
              >
                <p
                  className="font-display text-xl font-light"
                  style={{ color: "hsl(30 5% 50%)", letterSpacing: "-0.01em" }}
                >
                  AI agents that earn your trust over time.
                </p>
                <p className="mt-3 text-sm" style={{ color: "hsl(30 5% 58%)" }}>
                  Start free. No credit card required. Deploy in minutes.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
