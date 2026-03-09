"use client";

import Link from "next/link";
import { useSpend } from "@/hooks/use-spend";
import { useApprovalCount } from "@/hooks/use-approvals";
import { Skeleton } from "@/components/ui/skeleton";

interface TodayBannerProps {
  operatorName: string;
}

export function TodayBanner({ operatorName }: TodayBannerProps) {
  const { data: summaryData, isLoading } = useSpend();
  const pendingCount = useApprovalCount();

  // Today's leads: last item in trend array (ordered oldest → newest)
  const trend = summaryData?.spend.trend ?? [];
  const todayData = trend[trend.length - 1];
  const leadsToday = todayData?.leads ?? 0;
  const leadsMonth = summaryData?.outcomes.leads30d ?? 0;
  const bookingsMonth = summaryData?.outcomes.bookings30d ?? 0;

  if (isLoading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-5 w-56" />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/* Primary outcome statement — the answer to "did I get leads today?" */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {leadsToday === 0 ? (
          <p className="text-[26px] sm:text-[32px] font-light text-foreground leading-none tracking-tight">
            No new leads yet today
            <span className="ml-3 text-[18px] font-light text-muted-foreground">
              {operatorName} is working on it
            </span>
          </p>
        ) : (
          <>
            <p className="text-[32px] sm:text-[40px] font-light text-foreground leading-none tracking-tight">
              {leadsToday} new lead{leadsToday > 1 ? "s" : ""} today
            </p>
            {leadsMonth > 0 && (
              <p className="text-[18px] font-light text-muted-foreground leading-none">
                {leadsMonth} this month
              </p>
            )}
            {bookingsMonth > 0 && (
              <p className="text-[18px] font-light text-muted-foreground leading-none">
                · {bookingsMonth} booked
              </p>
            )}
          </>
        )}
      </div>

      {/* Pending approval CTA — operator amber, only shown when needed */}
      {pendingCount > 0 && (
        <div>
          <Link
            href="/approvals"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-operator/10 text-operator hover:bg-operator/15 transition-colors duration-fast text-[13px] font-medium"
          >
            {pendingCount === 1
              ? "1 decision is waiting for you"
              : `${pendingCount} decisions are waiting for you`}
            {" →"}
          </Link>
        </div>
      )}
    </section>
  );
}
