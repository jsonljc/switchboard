import type { Metadata } from "next";
import { getServerSession } from "@/lib/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title: "Switchboard — Hire AI agents that run your business",
  description:
    "Deploy AI agents for sales, creative, trading, and finance. They start supervised, earn your trust, and work 24/7.",
  openGraph: {
    title: "Switchboard — Hire AI agents that run your business",
    description:
      "Deploy AI agents for sales, creative, trading, and finance. They start supervised, earn your trust, and work 24/7.",
    type: "website",
  },
};

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const isAuthenticated = session !== null;

  return (
    <div className="light min-h-screen flex flex-col bg-background">
      <LandingNav isAuthenticated={isAuthenticated} />
      <main className="flex-1">{children}</main>
      <LandingFooter />
    </div>
  );
}
