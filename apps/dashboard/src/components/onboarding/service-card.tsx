"use client";

import { useState } from "react";
import type { PlaybookService, BookingBehavior } from "@switchboard/schemas";

const BOOKING_OPTIONS: { label: string; value: BookingBehavior }[] = [
  { label: "Book directly", value: "book_directly" },
  { label: "Consultation only", value: "consultation_only" },
  { label: "Ask first", value: "ask_first" },
];

interface ServiceCardProps {
  service: PlaybookService;
  onChange: (updated: PlaybookService) => void;
  onDelete: (id: string) => void;
}

export function ServiceCard({ service, onChange, onDelete }: ServiceCardProps) {
  const [name, setName] = useState(service.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isScanSourced = service.source === "scan";

  const handleNameBlur = () => {
    if (name !== service.name) {
      onChange({ ...service, name, source: "manual", status: "ready" });
    }
  };

  const handleBookingChange = (value: BookingBehavior) => {
    onChange({ ...service, bookingBehavior: value, source: "manual", status: "ready" });
  };

  return (
    <div
      className="rounded-lg border p-4 transition-all duration-200"
      style={{
        borderColor: "var(--sw-border)",
        backgroundColor:
          isScanSourced && service.status !== "ready" ? "rgba(160, 120, 80, 0.06)" : "white",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="flex-1 bg-transparent text-[16px] font-semibold outline-none focus:border-b focus:border-[var(--sw-accent)]"
          style={{ color: "var(--sw-text-primary)" }}
        />
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="ml-2 text-[14px] transition-colors hover:text-[var(--sw-text-primary)]"
            style={{ color: "var(--sw-text-muted)" }}
          >
            ✕
          </button>
        ) : (
          <span className="ml-2 flex items-center gap-2 text-[14px]">
            <span style={{ color: "var(--sw-text-secondary)" }}>Remove?</span>
            <button
              onClick={() => onDelete(service.id)}
              className="font-medium"
              style={{ color: "var(--sw-accent)" }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ color: "var(--sw-text-muted)" }}
            >
              Cancel
            </button>
          </span>
        )}
      </div>

      <div className="mb-2 text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
        {service.price !== undefined ? (
          <span>${service.price}</span>
        ) : (
          <span style={{ color: "var(--sw-accent)" }}>Needs price</span>
        )}
        {service.duration !== undefined && <span> · {service.duration} min</span>}
      </div>

      <select
        value={service.bookingBehavior}
        onChange={(e) => handleBookingChange(e.target.value as BookingBehavior)}
        className="h-[32px] rounded border bg-transparent px-2 text-[14px] outline-none"
        style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-secondary)" }}
      >
        {BOOKING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {isScanSourced && service.status !== "ready" && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--sw-text-muted)" }}>
          from website
        </p>
      )}
    </div>
  );
}
