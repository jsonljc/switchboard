import { BookingRow } from "./booking-row";
import { SectionLabel } from "./section-label";

interface BookingData {
  id: string;
  startsAt: string;
  service: string;
  contactName: string;
  status: "confirmed" | "pending";
}

interface BookingPreviewProps {
  bookings: BookingData[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function classifyStatus(booking: BookingData): "confirmed" | "pending" | "completed" {
  if (booking.status === "confirmed" && new Date(booking.startsAt) < new Date()) return "completed";
  return booking.status;
}

export function BookingPreview({ bookings }: BookingPreviewProps) {
  return (
    <div>
      <SectionLabel>Today&apos;s Bookings</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {bookings.length === 0 ? (
          <p
            style={{
              padding: "24px 20px",
              fontSize: "16px",
              color: "var(--sw-text-secondary)",
              margin: 0,
            }}
          >
            No bookings today
          </p>
        ) : (
          bookings.map((b, i) => (
            <div
              key={b.id}
              style={
                i < bookings.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
              }
            >
              <BookingRow
                time={formatTime(b.startsAt)}
                service={b.service}
                contact={b.contactName}
                status={classifyStatus(b)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
