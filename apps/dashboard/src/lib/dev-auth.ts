const DEV_DASHBOARD_SESSION = {
  user: {
    id: "dev-user",
    email: "dev@switchboard.local",
    name: "Dev User",
  },
  organizationId: "org_dev",
  principalId: "principal_dev",
  onboardingComplete: true,
  expires: "2099-01-01T00:00:00.000Z",
};

export function assertSafeDashboardAuthEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  // Skip during `next build` page-data collection, which loads route modules
  // (and the auth.ts that calls this assert) under NODE_ENV=production but
  // before NEXTAUTH_SECRET is needed. PR #260 added the same guard to auth.ts
  // but missed this call site.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  if (process.env.DEV_BYPASS_AUTH === "true") {
    throw new Error("DEV_BYPASS_AUTH cannot be enabled in production");
  }

  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET must be set in production");
  }

  // The dashboard talks to Postgres directly — the NextAuth Prisma adapter and the
  // per-org API client both `new PrismaClient()`. A missing DATABASE_URL otherwise
  // fails lazily at the first query with a cryptic Prisma error; preflight it so the
  // deploy refuses to start instead. (Mirrors the launch-checklist env requirement.)
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set in production. The dashboard reads Postgres directly; refusing to start without it.",
    );
  }

  // CREDENTIALS_ENCRYPTION_KEY decrypts each org's API credentials (get-api-client)
  // and must match the secret the API server encrypted them with. Without it, every
  // authenticated dashboard request fails lazily at the first decrypt; preflight it.
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be set in production. It decrypts per-org API credentials and must match the API server; refusing to start without it.",
    );
  }
}

export function isDevBypassEnabled(): boolean {
  assertSafeDashboardAuthEnv();
  return process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "true";
}

export function getDevDashboardSession() {
  return DEV_DASHBOARD_SESSION;
}
