interface BookingRowProps {
  time: string;
  service: string;
  contact: string;
  status: "confirmed" | "pending" | "completed";
}

const DOT_COLORS: Record<string, string> = {
  confirmed: "hsl(145, 45%, 42%)",
  pending: "var(--sw-accent)",
  completed: "var(--sw-text-muted)",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  completed: "Done",
};

export function BookingRow({ time, service, contact, status }: BookingRowProps) {
  const isMuted = status === "completed";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "16px 20px",
        opacity: isMuted ? 0.6 : 1,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          minWidth: "72px",
        }}
      >
        {time}
      </span>
      <span style={{ fontSize: "16px", color: "var(--sw-text-primary)", flex: 1 }}>
        {service} · {contact}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: DOT_COLORS[status] ?? "var(--sw-text-muted)",
          }}
        />
        <span style={{ fontSize: "13px", color: "var(--sw-text-muted)" }}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </span>
    </div>
  );
}
