import { signOut as nextAuthSignOut } from "next-auth/react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Sign out wrapper that clears the React Query cache before delegating
 * to NextAuth's signOut. Defense-in-depth on top of scoped query keys
 * (see @/lib/query-keys + @/hooks/use-query-keys) — even a future hook
 * that bypasses useScopedQueryKeys() can't leak across sessions because
 * the cache is empty at the moment of session change.
 */
export async function signOut(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  await nextAuthSignOut();
}
