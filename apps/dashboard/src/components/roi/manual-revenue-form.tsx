"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface ManualRevenueFormProps {
  onSuccess?: () => void;
}

export function ManualRevenueForm({ onSuccess }: ManualRevenueFormProps) {
  const [open, setOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [service, setService] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (body: {
      contactName: string;
      service: string;
      amount: number;
      date: string;
    }) => {
      const res = await fetch("/api/dashboard/roi/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to record revenue");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roi"] });
      setContactName("");
      setService("");
      setAmount("");
      setDate(new Date().toISOString().slice(0, 10));
      setOpen(false);
      onSuccess?.();
    },
  });

  const canSubmit = contactName.trim() && amount && parseFloat(amount) > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
      >
        + Record manually
      </button>
    );
  }

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <h3 className="text-sm font-semibold">Record Offline Booking / Revenue</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="mr-contact" className="text-sm text-muted-foreground">
            Contact Name <span className="text-destructive">*</span>
          </label>
          <input
            id="mr-contact"
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="e.g. Jane Tan"
            className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mr-service" className="text-sm text-muted-foreground">
            Service
          </label>
          <input
            id="mr-service"
            type="text"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="e.g. Facial Treatment"
            className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mr-amount" className="text-sm text-muted-foreground">
            Amount <span className="text-destructive">*</span>
          </label>
          <input
            id="mr-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mr-date" className="text-sm text-muted-foreground">
            Date
          </label>
          <input
            id="mr-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {mutation.isError && <p className="text-sm text-destructive">{mutation.error.message}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSubmit || mutation.isPending}
          onClick={() =>
            mutation.mutate({
              contactName: contactName.trim(),
              service: service.trim(),
              amount: parseFloat(amount),
              date,
            })
          }
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
