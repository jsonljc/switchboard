import type { Metadata } from "next";
import { getServerSession } from "@/lib/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title: "Switchboard — Never miss a lead again",
  description:
    "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
  openGraph: {
    title: "Switchboard — Never miss a lead again",
    description:
      "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
    type: "website",
  },
};

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const isAuthenticated = session !== null;

  return (
    <div
      className="light min-h-screen flex flex-col"
      style={{ background: "var(--sw-base)", fontFamily: "var(--font-display)" }}
    >
      <LandingNav isAuthenticated={isAuthenticated} />
      <main className="flex-1">{children}</main>
      <LandingFooter />
    </div>
  );
}
