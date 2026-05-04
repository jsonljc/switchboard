"use client";

import { useSession } from "next-auth/react";
import { useMemo } from "react";
import { scopedKeys } from "@/lib/query-keys";

/**
 * Returns a tenant-scoped React Query key factory bound to the current
 * session's organizationId, or `null` when no session is present.
 *
 * Consumers MUST guard against `null` and pass `enabled: !!keys` to their
 * `useQuery` so disabled queries do not fire while the session is loading
 * or signed-out. Use a `["__disabled_<scope>__"]` sentinel as the queryKey
 * fallback — it will never be exercised because `enabled: false` short-circuits.
 *
 * Mutation hooks should guard cache invalidation with `if (keys) { ... }`
 * so an in-flight mutation that resolves after sign-out does not crash.
 */
export function useScopedQueryKeys() {
  const { data: session } = useSession();
  const orgId = (session as unknown as { organizationId?: string } | null)?.organizationId;
  return useMemo(() => (orgId ? scopedKeys(orgId) : null), [orgId]);
}

/**
 * Returns the orgId backing `useScopedQueryKeys` plus the keys factory in one
 * shape, or `null` when no session is present. Use this when a consumer needs
 * orgId for something other than React Query key construction (e.g. handing
 * orgId to a server-side dispatcher that builds its own keys).
 */
export function useTenantContext(): { orgId: string; keys: ReturnType<typeof scopedKeys> } | null {
  const { data: session } = useSession();
  const orgId = (session as unknown as { organizationId?: string } | null)?.organizationId;
  return useMemo(() => (orgId ? { orgId, keys: scopedKeys(orgId) } : null), [orgId]);
}
