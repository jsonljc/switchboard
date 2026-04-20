import { formatRelative } from "@/lib/format";

interface ActivityEventProps {
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
}

const DOT_CSS: Record<string, string> = {
  green: "hsl(145, 45%, 42%)",
  amber: "var(--sw-accent)",
  blue: "hsl(210, 50%, 50%)",
  gray: "var(--sw-text-muted)",
};

export function ActivityEvent({ description, dotColor, createdAt }: ActivityEventProps) {
  return (
    <div style={{ display: "flex", alignItems: "start", gap: "12px", padding: "12px 0" }}>
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: DOT_CSS[dotColor] ?? DOT_CSS.gray,
          marginTop: "7px",
          flexShrink: 0,
        }}
      />
      <p style={{ flex: 1, fontSize: "16px", color: "var(--sw-text-primary)", margin: 0 }}>
        {description}
      </p>
      <time style={{ fontSize: "13px", color: "var(--sw-text-muted)", flexShrink: 0 }}>
        {formatRelative(createdAt)}
      </time>
    </div>
  );
}
