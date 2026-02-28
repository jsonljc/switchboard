"use client";

import { SessionProvider, SessionContext } from "next-auth/react";
import { useMemo, type ReactNode } from "react";

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true";

const DEV_SESSION = {
  user: {
    id: "dev-user",
    email: "dev@switchboard.local",
    name: "Dev User",
  },
  organizationId: "org_dev",
  principalId: "principal_dev",
  expires: "2099-01-01",
};

function DevSessionProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      data: DEV_SESSION,
      status: "authenticated" as const,
      async update() {
        return DEV_SESSION;
      },
    }),
    []
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (DEV_BYPASS) {
    return <DevSessionProvider>{children}</DevSessionProvider>;
  }
  return <SessionProvider>{children}</SessionProvider>;
}
