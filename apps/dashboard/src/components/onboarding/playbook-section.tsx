"use client";

import { useState } from "react";
import type { PlaybookSectionStatus } from "@switchboard/schemas";

const STATUS_CONFIG: Record<
  PlaybookSectionStatus,
  { label: string; dotColor: string; borderColor: string }
> = {
  ready: { label: "Ready", dotColor: "hsl(145, 45%, 42%)", borderColor: "hsl(145, 45%, 42%)" },
  check_this: {
    label: "Check this",
    dotColor: "var(--sw-accent)",
    borderColor: "var(--sw-accent)",
  },
  missing: { label: "Missing", dotColor: "var(--sw-text-muted)", borderColor: "var(--sw-border)" },
};

interface PlaybookSectionProps {
  title: string;
  status: PlaybookSectionStatus;
  required: boolean;
  defaultCollapsed?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}

export function PlaybookSection({
  title,
  status,
  required,
  defaultCollapsed = false,
  highlight = false,
  children,
}: PlaybookSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const config = STATUS_CONFIG[status];

  return (
    <div
      className="overflow-hidden rounded-xl border transition-all duration-200"
      style={{
        borderColor: required ? "var(--sw-border-strong)" : "var(--sw-border)",
        borderLeftWidth: "3px",
        borderLeftColor: highlight ? "var(--sw-accent)" : config.borderColor,
      }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--sw-surface)]"
      >
        <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
          {title}
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: config.dotColor }}
          />
          <span className="text-[14px]" style={{ color: config.dotColor }}>
            {config.label}
          </span>
        </span>
      </button>
      {!collapsed && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}
