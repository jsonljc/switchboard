"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "./use-query-keys";
import { createIdempotencyKey } from "@/lib/idempotency";

interface RecordAttendanceInput {
  bookingId: string;
  outcome: "attended" | "no_show";
}

/** Mutation hook to mark a booking attended or no_show via the dashboard proxy. */
export function useRecordAttendance() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  return useMutation({
    mutationFn: async ({ bookingId, outcome }: RecordAttendanceInput): Promise<unknown> => {
      const res = await fetch(`/api/dashboard/bookings/${bookingId}/attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({ outcome, recordedBy: "staff" }),
      });
      if (!res.ok) throw new Error(`Attendance record failed (HTTP ${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        void queryClient.invalidateQueries({ queryKey: keys.bookingWins.feed("alex") });
        void queryClient.invalidateQueries({ queryKey: keys.reports.all() });
      }
    },
  });
}
