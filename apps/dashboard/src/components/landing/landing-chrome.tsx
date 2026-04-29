import { getServerSession } from "@/lib/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";

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
