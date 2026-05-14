// apps/dashboard/src/components/cockpit/approval-block.tsx
import { ApprovalCard } from "./approval-card";
import type { ApprovalView } from "./types";

export interface ApprovalBlockProps {
  data: ApprovalView[];
  onResolve: (verdict: "accept" | "decline", idx: number) => void;
  compact?: boolean;
}

export function ApprovalBlock({ data, onResolve, compact = false }: ApprovalBlockProps) {
  if (data.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 12 : 14,
        margin: compact ? "16px 18px 0" : "20px 28px 0",
      }}
    >
      {data.map((item, i) => (
        <ApprovalCard
          key={item.id}
          data={item}
          idx={i}
          total={data.length}
          onResolve={onResolve}
          compact={compact}
        />
      ))}
    </div>
  );
}
