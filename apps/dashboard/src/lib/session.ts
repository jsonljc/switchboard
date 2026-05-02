import { auth } from "./auth";
import { assertSafeDashboardAuthEnv, getDevDashboardSession, isDevBypassEnabled } from "./dev-auth";

export interface DashboardSession {
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  organizationId: string;
  principalId: string;
  onboardingComplete: boolean;
  expires: string;
}

export async function getServerSession(): Promise<DashboardSession | null> {
  assertSafeDashboardAuthEnv();

  if (isDevBypassEnabled()) {
    return getDevDashboardSession();
  }

  const session = await auth();
  if (!session?.user?.id) return null;
  return session as unknown as DashboardSession;
}

export async function requireSession(): Promise<DashboardSession> {
  const session = await getServerSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}
