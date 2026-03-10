"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 2-minute stale window: prevents refetch on every navigation
            staleTime: 2 * 60 * 1000,
            // Keep data in cache for 10 minutes after all subscribers unmount
            gcTime: 10 * 60 * 1000,
            // Disable window-focus refetch — it triggers all queries simultaneously
            // when the user alt-tabs back to the dashboard (e.g. from Telegram)
            refetchOnWindowFocus: false,
            // Only retry once on failure — prevents long waterfall on API errors
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
