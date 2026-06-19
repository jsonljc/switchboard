import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./page-title.module.css";

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
 * a Source Serif (--serif) display title, with an optional supporting line. The
 * type and ink live in page-title.module.css using the global editorial tokens
 * (--mono, --serif, --ink, --ink-3), matching reports.module.css. Server-safe.
 */
export function PageTitle({ eyebrow, children, sub, className }: PageTitleProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      <h1 className={styles.title}>{children}</h1>
      {sub ? <p className={styles.sub}>{sub}</p> : null}
    </div>
  );
}
