import type { Metadata } from "next";
import { HomepageHero } from "@/components/landing/homepage-hero";
import { BeforeAfterSection } from "@/components/landing/before-after-section";
import { ScrollytellingSection } from "@/components/landing/scrollytelling-section";
import { ProofBar } from "@/components/landing/proof-bar";
import { TrustCards } from "@/components/landing/trust-cards";
import { PricingSection } from "@/components/landing/pricing-section";
import { FinalCta } from "@/components/landing/final-cta";

export const metadata: Metadata = {
  title: "Switchboard — Never miss a lead again",
  description:
    "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
};

export default function HomePage() {
  return (
    <>
      <HomepageHero />
      <BeforeAfterSection />
      <ScrollytellingSection />
      <section style={{ background: "#F5F3F0", paddingBottom: "5rem" }}>
        <div className="page-width">
          <ProofBar />
          <TrustCards />
        </div>
      </section>
      <PricingSection />
      <FinalCta />
    </>
  );
}
