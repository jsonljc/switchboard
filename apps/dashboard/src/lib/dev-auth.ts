const DEV_DASHBOARD_SESSION = {
  user: {
    id: "dev-user",
    email: "dev@switchboard.local",
    name: "Dev User",
  },
  organizationId: "org_dev",
  principalId: "principal_dev",
  expires: "2099-01-01T00:00:00.000Z",
};

export function assertSafeDashboardAuthEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (process.env.DEV_BYPASS_AUTH === "true") {
    throw new Error("DEV_BYPASS_AUTH cannot be enabled in production");
  }

  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET must be set in production");
  }
}

export function isDevBypassEnabled(): boolean {
  assertSafeDashboardAuthEnv();
  return process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "true";
}

export function getDevDashboardSession() {
  return DEV_DASHBOARD_SESSION;
}
