export default function MarketplaceLoading() {
  return (
    <div className="pt-28 pb-20">
      <div className="page-width">
        {/* Hero skeleton */}
        <div className="text-center space-y-4 mb-12">
          <div className="h-10 w-64 bg-border/30 rounded mx-auto animate-pulse" />
          <div className="h-5 w-96 bg-border/30 rounded mx-auto animate-pulse" />
        </div>
        {/* Tab bar skeleton */}
        <div className="flex gap-4 border-b border-border mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-24 bg-border/30 rounded animate-pulse" />
          ))}
        </div>
        {/* Bundle card skeleton */}
        <div className="h-64 bg-border/20 rounded-xl animate-pulse mb-8" />
        {/* Agent cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-96 bg-border/20 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
