import { HeroSection } from "@/components/landing/hero-section";
import { TimelineSection } from "@/components/landing/timeline-section";
import { StatsSection } from "@/components/landing/stats-section";
import { TrustSection } from "@/components/landing/trust-section";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <TimelineSection />
      <StatsSection />
      <TrustSection />
    </>
  );
}
