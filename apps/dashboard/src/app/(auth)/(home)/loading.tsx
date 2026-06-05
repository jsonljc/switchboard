import { Skeleton } from "@/components/ui/skeleton";

/** Route shell for Home — verdict hero + bento module placeholders. */
export default function HomeLoading() {
  return (
    <div role="status" aria-label="Loading your briefing" className="flex flex-col gap-6 py-2">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 lg:col-span-2" />
        <Skeleton className="h-40" />
        <Skeleton className="h-28 lg:col-span-2" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}
