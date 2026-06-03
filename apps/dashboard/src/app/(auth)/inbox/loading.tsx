import { Skeleton } from "@/components/ui/skeleton";

/** Route shell for the Inbox — masthead, filter chips, ghost decision rows. */
export default function InboxLoading() {
  return (
    <div role="status" aria-label="Loading your inbox" className="flex flex-col gap-5 py-2">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
