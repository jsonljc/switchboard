"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

interface AuditEvent {
  eventType: string;
  timestamp: string;
  summary: string;
}

export function EventHistory() {
  const keys = useScopedQueryKeys();
  const { data, isLoading } = useQuery({
    queryKey: keys?.audit.list({ limit: "20" }) ?? ["__disabled_audit_list__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/audit?limit=20");
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json() as Promise<{ entries: AuditEvent[] }>;
    },
    enabled: !!keys,
  });

  if (isLoading) return <p className="text-[13px] text-muted-foreground">Loading events...</p>;

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No recent events.</p>
      ) : (
        entries.map((entry, i) => (
          <div key={i} className="px-3 py-2 rounded-lg border border-border text-[13px]">
            <div className="flex justify-between">
              <span className="font-medium text-foreground">{entry.eventType}</span>
              <span className="text-muted-foreground text-[11px]">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-muted-foreground text-[12px] mt-0.5">{entry.summary}</p>
          </div>
        ))
      )}
    </div>
  );
}
