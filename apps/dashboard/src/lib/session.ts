import { auth } from "./auth";

export interface DashboardSession {
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  organizationId: string;
  principalId: string;
}

const DEV_SESSION: DashboardSession = {
  user: { id: "dev-user", email: "dev@switchboard.local", name: "Dev User" },
  organizationId: "org_dev",
  principalId: "principal_dev",
};

export async function getServerSession(): Promise<DashboardSession | null> {
  if (process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true") {
    return DEV_SESSION;
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
