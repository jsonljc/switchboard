// apps/dashboard/src/components/layout/data-mode-banner.tsx
"use client";

import { useDataMode } from "@/lib/data-mode/client";

/**
 * Global indicator strip rendered at the top of the page whenever data
 * mode is "demo". Quiet amber styling — not an error state. Visible to any
 * session, not gated on dev-user (stakeholders viewing preview deployments
 * need to know they're looking at demo data).
 *
 * NOT sticky-positioned: the editorial shell's `.app-header` is `sticky top-0
 * z-50` and would collide. Banner scrolls with the page; the persistent
 * indicator on scroll can be added later by coordinating header offset.
 */
export function DataModeBanner() {
  const mode = useDataMode();
  if (mode !== "demo") return null;

  return (
    <div
      role="status"
      title="Live systems are not being queried."
      className="flex items-center justify-center bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
    >
      Demo data mode
    </div>
  );
}
