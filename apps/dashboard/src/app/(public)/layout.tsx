import type { Metadata } from "next";
import { getServerSession } from "@/lib/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title: "Switchboard — Meet your team",
  description:
    "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
  openGraph: {
    title: "Switchboard — Meet your team",
    description:
      "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
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
