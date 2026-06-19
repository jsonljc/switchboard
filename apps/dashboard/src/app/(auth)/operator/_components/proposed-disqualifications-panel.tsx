"use client";

import { usePendingDisqualifications } from "@/hooks/use-pending-disqualifications";
import { StatePanel, Skeleton } from "@/components/query-states";
import { DisqualificationRow } from "./disqualification-row";

export function ProposedDisqualificationsPanel() {
  const { data, isLoading, isError, refetch } = usePendingDisqualifications();

  return (
    <section className="border-t border-border pt-6 mt-6">
      <p className="section-label mb-4">Proposed Disqualifications</p>

      {isLoading && <Skeleton className="h-20 w-full" />}

      {isError && (
        <StatePanel
          role="alert"
          eyebrow="Couldn't load"
          title="We couldn't reach this list."
          body="This is usually momentary. Try again in a moment."
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && data?.items.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No proposed disqualifications.</p>
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 pr-4 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Thread
                </th>
                <th className="pb-2 pr-4 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Contact
                </th>
                <th className="pb-2 pr-4 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  State
                </th>
                <th className="pb-2 pr-4 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Signal
                </th>
                <th className="pb-2 pr-4 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Evidence
                </th>
                <th className="pb-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <DisqualificationRow key={item.conversationThreadId} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
