import { Skeleton } from "@/components/query-states/skeleton";

/**
 * Page-level loading placeholder for the knowledge settings surface.
 * Composes the shared editorial Skeleton (warm hairline pulse, no bg-muted)
 * to satisfy audit finding B1. Preserves the same overall layout shape.
 */
export function KnowledgeSkeleton() {
  return (
    <div className="space-y-4" data-testid="knowledge-skeleton">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}
