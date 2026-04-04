"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useListings } from "@/hooks/use-marketplace";
import { ListingCard } from "@/components/marketplace/listing-card";
import { CategoryFilter } from "@/components/marketplace/category-filter";

export default function MarketplacePage() {
  const { status } = useSession();
  const { data, isLoading } = useListings({ status: "listed" });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (status === "unauthenticated") redirect("/login");

  const listings = data ?? [];

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const l of listings) {
      for (const c of l.taskCategories) cats.add(c);
    }
    return [...cats].sort();
  }, [listings]);

  const filtered = selectedCategory
    ? listings.filter((l) => l.taskCategories.includes(selectedCategory))
    : listings;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Marketplace</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Pre-vetted AI agents rated on real task outcomes. Deploy with one click.
        </p>
      </section>

      {allCategories.length > 0 && (
        <CategoryFilter
          categories={allCategories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {status === "loading" || isLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[15px] text-foreground font-medium">No agents found.</p>
          <p className="text-[14px] text-muted-foreground mt-1.5">
            {selectedCategory ? "Try a different category." : "Check back soon for new listings."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
