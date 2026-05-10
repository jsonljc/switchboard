"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { ContactDetailResponseSchema, type ContactDetailResponse } from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { CONTACT_DETAIL_FIXTURES } from "../fixtures";

// Read process.env per call so vitest can mutate NEXT_PUBLIC_CONTACTS_LIVE
// between fixture-branch and live-branch tests. Mirrors useContactsList.
const isLive = (): boolean => process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true";

export type UseContactDetailResult =
  | UseQueryResult<ContactDetailResponse, Error>
  | {
      data: ContactDetailResponse;
      isLoading: false;
      isError: false;
      error: null;
      refetch: () => Promise<{ data: ContactDetailResponse }>;
    };

export function useContactDetail(contactId: string): UseContactDetailResult {
  const keys = useScopedQueryKeys();
  const live = isLive();

  // Always call useQuery (hooks rules); disable in fixture mode rather than
  // skipping the call. Sentinel queryKey when no session keys yet.
  const query = useQuery<ContactDetailResponse, Error>({
    queryKey:
      keys?.contacts.detail(contactId) ?? (["__disabled_contact_detail__", contactId] as const),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/contacts/${encodeURIComponent(contactId)}`);
      if (res.status === 404) notFound();
      if (!res.ok) throw new Error(`Failed to load contact: ${res.status}`);
      // Validate at the boundary — surfacing a ZodError as React Query's
      // isError is more useful than rendering "Invalid Date" cells deeper in
      // the tree if the upstream contract drifts.
      return ContactDetailResponseSchema.parse(await res.json());
    },
    enabled: live && !!keys,
    staleTime: 30_000,
  });

  if (!live) {
    const fixture = CONTACT_DETAIL_FIXTURES[contactId];
    if (!fixture) notFound();
    return {
      data: fixture,
      isLoading: false,
      isError: false,
      error: null,
      refetch: async () => ({ data: fixture }),
    };
  }

  return query;
}
