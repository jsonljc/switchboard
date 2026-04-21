import Link from "next/link";

import { OwnerTaskRow } from "./owner-task-row";
import { SectionLabel } from "./section-label";

interface TaskData {
  id: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
}
interface OwnerTaskListProps {
  tasks: TaskData[];
  onComplete: (id: string) => void;
}

export function OwnerTaskList({ tasks, onComplete }: OwnerTaskListProps) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <SectionLabel>Your Tasks</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {tasks.slice(0, 5).map((task, i) => (
          <div
            key={task.id}
            style={
              i < Math.min(tasks.length, 5) - 1
                ? { borderBottom: "1px solid var(--sw-border)" }
                : undefined
            }
          >
            <OwnerTaskRow
              id={task.id}
              title={task.title}
              dueAt={task.dueAt}
              isOverdue={task.isOverdue}
              onComplete={onComplete}
            />
          </div>
        ))}
      </div>
      {tasks.length > 5 && (
        <Link
          href="/tasks"
          style={{
            display: "inline-block",
            marginTop: "12px",
            fontSize: "14px",
            color: "var(--sw-accent)",
            textDecoration: "none",
          }}
        >
          View all {tasks.length} →
        </Link>
      )}
    </div>
  );
}
