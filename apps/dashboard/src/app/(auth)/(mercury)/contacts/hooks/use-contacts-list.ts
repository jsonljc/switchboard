"use client";

import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import {
  ContactsListResponseSchema,
  type ContactsListQuery,
  type ContactsListResponse,
} from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { CONTACTS_FIXTURE_PAGE } from "../fixtures";

export type ContactsListQueryInput = Partial<Omit<ContactsListQuery, "cursor">>;

export type UseContactsListResult = UseInfiniteQueryResult<
  { pages: ContactsListResponse[]; pageParams: (string | undefined)[] },
  Error
>;

const isLive = (): boolean => isMercuryToolLive("contacts");

function buildSearch(query: ContactsListQueryInput, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.stage) params.set("stage", query.stage);
  if (query.search) params.set("search", query.search);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useContactsList(query: ContactsListQueryInput): UseContactsListResult {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useInfiniteQuery<
    ContactsListResponse,
    Error,
    { pages: ContactsListResponse[]; pageParams: (string | undefined)[] },
    readonly unknown[],
    string | undefined
  >({
    queryKey: keys?.contacts.list(query) ?? (["__disabled_contacts__", query] as const),
    queryFn: async ({ pageParam }) => {
      if (!live) return CONTACTS_FIXTURE_PAGE;
      const res = await fetch(`/api/dashboard/contacts${buildSearch(query, pageParam)}`);
      if (!res.ok) throw new Error(`Failed to load contacts: ${res.status}`);
      // Validate at the boundary — surfacing a ZodError as React Query's
      // isError is more useful than rendering "Invalid Date" cells deeper in
      // the tree if the upstream contract drifts.
      return ContactsListResponseSchema.parse(await res.json());
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (live ? (last.nextCursor ?? undefined) : undefined),
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
  });
}
