import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const noticeBarVariants = cva(
  "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs font-medium ring-1",
  {
    variants: {
      tone: {
        // Light caution tint ground carries the tone; dark --foreground ink
        // carries the text (~15:1). The mid-tone text-caution on this tint is
        // only ~4.4:1 (fails AA), so we never pair them. See Badge #4b note.
        caution: "bg-caution-subtle text-foreground ring-caution/25",
      },
    },
    defaultVariants: { tone: "caution" },
  },
);

export type NoticeBarProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof noticeBarVariants>;

/**
 * Shared full-width notice strip for top-of-app messages (demo-data mode,
 * verify-email). Passive by default (role="status", never "alert") and built on
 * the semantic caution tokens instead of raw Tailwind amber (audit M1). The
 * opaque tint ground covers the page grain, so the text contrast is measured
 * against the tint, not the canvas.
 */
export function NoticeBar({ tone, className, children, ...props }: NoticeBarProps) {
  return (
    <div role="status" className={cn(noticeBarVariants({ tone }), className)} {...props}>
      {children}
    </div>
  );
}
