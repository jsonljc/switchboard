import type { Metadata } from "next";
import { PublicMarketplaceBrowse } from "@/components/marketplace/public-marketplace-browse";

export const metadata: Metadata = {
  title: "Marketplace — Switchboard",
  description: "Browse AI agents for your business. Deploy them in minutes.",
};

export default function PublicMarketplacePage() {
  return <PublicMarketplaceBrowse />;
}
