import { useQuery, useMutation } from "@tanstack/react-query";
import type { BillingStatus, CheckoutResult, PortalResult } from "@/lib/api-client";

export function useBillingStatus() {
  return useQuery<BillingStatus>({
    queryKey: ["billing", "status"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/billing/status");
      if (!res.ok) throw new Error("Failed to fetch billing status");
      return res.json() as Promise<BillingStatus>;
    },
  });
}

export function useCheckout() {
  return useMutation<CheckoutResult, Error, string>({
    mutationFn: async (priceId: string) => {
      const res = await fetch("/api/dashboard/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      if (!res.ok) throw new Error("Failed to create checkout");
      return res.json() as Promise<CheckoutResult>;
    },
  });
}

export function usePortal() {
  return useMutation<PortalResult, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/dashboard/billing/portal", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to create portal session");
      return res.json() as Promise<PortalResult>;
    },
  });
}
