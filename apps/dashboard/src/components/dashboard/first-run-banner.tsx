"use client";

import { useState } from "react";

interface FirstRunBannerProps {
  onDismiss: () => void;
}

const ACTIONS = [
  { title: "Review first conversations", href: "/decide" },
  { title: "Send a test lead", href: "/my-agent" },
  { title: "Refine your playbook", href: "/settings/playbook" },
];

export function FirstRunBanner({ onDismiss }: FirstRunBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className="mb-6 rounded-xl border p-6"
      style={{
        backgroundColor: "var(--sw-surface-raised, hsl(40 20% 98%))",
        borderColor: "var(--sw-border, hsl(35 12% 82%))",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          className="text-[16px] font-semibold"
          style={{ color: "var(--sw-text-primary, hsl(30 12% 10%))" }}
        >
          Alex is live. Here are your next best steps.
        </h2>
        <button
          onClick={() => {
            setDismissed(true);
            onDismiss();
          }}
          className="text-[16px]"
          style={{ color: "var(--sw-text-muted, hsl(30 8% 60%))" }}
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACTIONS.map((action) => (
          <a
            key={action.title}
            href={action.href}
            className="rounded-lg border p-4 transition-colors hover:border-[var(--sw-border-strong)]"
            style={{ borderColor: "var(--sw-border)", backgroundColor: "var(--sw-surface)" }}
          >
            <p className="text-[14px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
              {action.title}
            </p>
            <span className="mt-2 block text-[14px]" style={{ color: "var(--sw-accent)" }}>
              →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
