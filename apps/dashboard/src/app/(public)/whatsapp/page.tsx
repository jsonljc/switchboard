import type { Metadata } from "next";
import "@/components/landing/v6/landing-v6.css";
import { WhatsAppTopbar } from "@/components/landing/whatsapp/topbar";
import { WhatsAppHero } from "@/components/landing/whatsapp/hero";
import { WhatsAppStoryRail } from "@/components/landing/whatsapp/story-rail";
import { WhatsAppFeaturesGrid } from "@/components/landing/whatsapp/features-grid";
import { WhatsAppOperatorBlock } from "@/components/landing/whatsapp/operator-block";
import { WhatsAppCloser } from "@/components/landing/whatsapp/closer";
import { WhatsAppFooterMini } from "@/components/landing/whatsapp/footer-mini";

export const metadata: Metadata = {
  title: "Switchboard for WhatsApp Business — Managed by Alex",
  description:
    "Switchboard is a WhatsApp Business Platform Tech Provider. Alex is the AI reply agent that drafts answers inside the 24-hour session window and escalates anything risky.",
  openGraph: {
    title: "Switchboard for WhatsApp Business — Managed by Alex",
    description:
      "WhatsApp Business Platform, with an AI reply agent on top. Numbers, templates, quality, audit — and Alex drafting in your voice.",
    type: "website",
  },
};

export default function WhatsAppPage() {
  return (
    <div data-v6-landing className="overflow-x-hidden">
      <WhatsAppTopbar />
      <WhatsAppHero />
      <WhatsAppStoryRail />
      <WhatsAppFeaturesGrid />
      <WhatsAppOperatorBlock />
      <WhatsAppCloser />
      <WhatsAppFooterMini />
    </div>
  );
}
