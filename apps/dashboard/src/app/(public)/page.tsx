import type { Metadata } from "next";
import "@/components/landing/v6/landing-v6.css";
import { V6Glyphs } from "@/components/landing/v6/glyphs";
import { AgentProvider } from "@/components/landing/v6/agent-context";
import { V6Topbar } from "@/components/landing/v6/topbar";
import { V6Hero } from "@/components/landing/v6/hero";
import { V6Synergy } from "@/components/landing/v6/synergy";
import { V6BeatAlex } from "@/components/landing/v6/beat-alex";
import { V6BeatNova } from "@/components/landing/v6/beat-nova";
import { V6BeatMira } from "@/components/landing/v6/beat-mira";
import { V6Control } from "@/components/landing/v6/control";
import { V6Pricing } from "@/components/landing/v6/pricing";
import { V6Closer } from "@/components/landing/v6/closer";
import { V6Footer } from "@/components/landing/v6/footer";
import { V6Dock } from "@/components/landing/v6/dock";

export const metadata: Metadata = {
  title: "Switchboard — Hire your revenue desk. One agent at a time.",
  description:
    "Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share what they learn.",
};

export default function HomePage() {
  return (
    <div data-v6-landing className="overflow-x-hidden">
      <AgentProvider>
        <V6Glyphs />
        <V6Topbar />
        <V6Hero />
        <V6Synergy />
        <V6BeatAlex />
        <V6BeatNova />
        <V6BeatMira />
        <V6Control />
        <V6Pricing />
        <V6Closer />
        <V6Footer />
        <V6Dock />
      </AgentProvider>
    </div>
  );
}
