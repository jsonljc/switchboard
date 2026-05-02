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
