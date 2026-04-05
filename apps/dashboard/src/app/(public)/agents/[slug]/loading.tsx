export default function AgentProfileLoading() {
  return (
    <div className="pt-28 pb-20">
      <div className="page-width max-w-3xl mx-auto">
        <div className="flex flex-col items-center gap-4">
          <div className="w-48 h-48 bg-border/20 rounded-full animate-pulse" />
          <div className="h-8 w-48 bg-border/30 rounded animate-pulse" />
          <div className="h-5 w-64 bg-border/30 rounded animate-pulse" />
          <div className="h-10 w-32 bg-border/30 rounded animate-pulse mt-4" />
        </div>
        <div className="h-64 bg-border/20 rounded-xl animate-pulse mt-12" />
      </div>
    </div>
  );
}
