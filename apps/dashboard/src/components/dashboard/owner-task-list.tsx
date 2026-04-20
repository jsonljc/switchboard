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
        {tasks.map((task, i) => (
          <div
            key={task.id}
            style={
              i < tasks.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
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
    </div>
  );
}
