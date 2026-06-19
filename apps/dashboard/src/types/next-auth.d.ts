import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
    };
    organizationId: string;
    principalId: string;
    onboardingComplete: boolean;
    // ISO timestamp when the email was verified, or null if not yet verified.
    // Refreshed from the DB on each token refresh (see lib/auth.ts). Optional so
    // the narrower DashboardSession (lib/session.ts) stays assignable to Session.
    emailVerified?: string | null;
  }

  interface User {
    organizationId?: string;
    principalId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    organizationId?: string;
    principalId?: string;
    onboardingComplete?: boolean;
  }
}
