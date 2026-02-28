"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { CartridgeManifest } from "@switchboard/schemas";

async function fetchCartridges(): Promise<{ cartridges: CartridgeManifest[] }> {
  const res = await fetch("/api/dashboard/cartridges");
  if (!res.ok) throw new Error("Failed to fetch cartridges");
  return res.json();
}

export function useCartridges() {
  return useQuery({
    queryKey: queryKeys.cartridges.list(),
    queryFn: fetchCartridges,
  });
}
