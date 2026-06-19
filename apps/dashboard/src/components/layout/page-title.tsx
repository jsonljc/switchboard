import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageTitleProps {
  /** Mono uppercase kicker above the title (the /reports "Statement" eyebrow). */
  eyebrow?: ReactNode;
  /** The serif display title. */
  children: ReactNode;
  /** Optional supporting sentence below the title. */
  sub?: ReactNode;
  className?: string;
}

/**
 * The ONE editorial page header, codifying the /reports high-water-mark voice so
 * every authed surface speaks in one hand: a JetBrains-mono uppercase eyebrow over
 * a Source Serif display title, with an optional supporting line. Uses global
 * tokens (--mono, --serif, --ink, --ink-3) so it renders correctly on any authed
 * surface. Server-component safe (no client hooks).
 */
export function PageTitle({ eyebrow, children, sub, className }: PageTitleProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {eyebrow ? (
        <span
          className="block uppercase"
          style={{
            fontFamily: "var(--mono)",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "hsl(var(--ink-3))",
          }}
        >
          {eyebrow}
        </span>
      ) : null}
      <h1
        style={{
          fontFamily: "var(--serif)",
          fontSize: "clamp(30px, 3.4vw, 42px)",
          fontWeight: 500,
          lineHeight: 1.04,
          letterSpacing: "-0.014em",
          color: "hsl(var(--ink))",
        }}
      >
        {children}
      </h1>
      {sub ? (
        <p
          className="max-w-2xl"
          style={{ fontSize: "15px", lineHeight: 1.6, color: "hsl(var(--ink-3))" }}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}
