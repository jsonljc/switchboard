export function KnowledgeSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" data-testid="knowledge-skeleton">
      <div className="h-7 w-48 rounded bg-muted" />
      <div className="h-4 w-80 max-w-full rounded bg-muted" />
      <div className="h-44 rounded-xl bg-muted" />
    </div>
  );
}
