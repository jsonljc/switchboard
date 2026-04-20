import Link from "next/link";
import { ActivityEvent } from "./activity-event";
import { SectionLabel } from "./section-label";

interface ActivityItem {
  id: string;
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
}
interface ActivityFeedProps {
  events: ActivityItem[];
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  return (
    <div>
      <SectionLabel>Recent Activity</SectionLabel>
      <div style={{ marginTop: "12px" }}>
        {events.length === 0 ? (
          <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", padding: "12px 0" }}>
            No activity yet. When Alex takes action, it will appear here.
          </p>
        ) : (
          events.map((event, i) => (
            <div
              key={event.id}
              style={
                i < events.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
              }
            >
              <ActivityEvent
                description={event.description}
                dotColor={event.dotColor}
                createdAt={event.createdAt}
              />
            </div>
          ))
        )}
        {events.length > 0 && (
          <Link
            href="/dashboard"
            style={{
              display: "inline-block",
              marginTop: "16px",
              fontSize: "14px",
              color: "var(--sw-accent)",
              textDecoration: "none",
            }}
          >
            See all activity →
          </Link>
        )}
      </div>
    </div>
  );
}
