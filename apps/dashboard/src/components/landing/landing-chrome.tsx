import { getServerSession } from "@/lib/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";

// Scope: wraps /privacy and /terms only. The home page (/) uses V6Topbar +
// V6Footer instead — see apps/dashboard/src/app/(public)/page.tsx.
export async function LandingChrome({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const isAuthenticated = session !== null;

  return (
    <>
      <LandingNav isAuthenticated={isAuthenticated} />
      {children}
      <LandingFooter />
    </>
  );
}
