"use client";

import Link from "next/link";
import { useApprovalCount } from "@/hooks/use-approvals";

interface TodayBannerProps {
  operatorName: string;
}

export function TodayBanner({ operatorName }: TodayBannerProps) {
  const pendingCount = useApprovalCount();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <p className="text-[26px] sm:text-[32px] font-light text-foreground leading-none tracking-tight">
          {operatorName} is ready
        </p>
      </div>

      {pendingCount > 0 && (
        <div>
          <Link
            href="/decide"
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
