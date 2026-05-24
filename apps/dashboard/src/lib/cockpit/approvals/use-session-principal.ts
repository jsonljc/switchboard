"use client";

import { useSession } from "next-auth/react";

interface PrincipalSession {
  principalId?: string;
  organizationId?: string;
}

/**
 * Returns the authenticated principal id from the next-auth session, or null
 * when no session is present. Encapsulates the `as unknown as` cast that the
 * dashboard's session typing currently requires, so it lives in one place
 * instead of being scattered across components.
 */
export function useSessionPrincipal(): string | null {
  const { data } = useSession();
  return (data as unknown as PrincipalSession | null)?.principalId ?? null;
}
