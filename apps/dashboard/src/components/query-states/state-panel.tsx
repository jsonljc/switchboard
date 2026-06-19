import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./state-panel.module.css";

export interface StatePanelProps {
  /** Optional decorative icon (e.g. a lucide <CloudOff />). */
  icon?: ReactNode;
  /** Mono uppercase kicker (e.g. "Couldn't load"). */
  eyebrow?: ReactNode;
  /** The serif headline — a human explanation, NEVER a raw status code. Rendered as a heading. */
  title: ReactNode;
  /** Calm supporting copy. */
  body?: ReactNode;
  /** "alert" for genuine failures (assertive), "status" for calm empty/all-clear. */
  role?: "status" | "alert";
  /** Accessible name for the region. */
  label?: string;
  /** When set, renders the canonical amber action-colored retry button. */
  onRetry?: () => void;
  /** Retry button label. */
  retryLabel?: string;
  /** Small footer slot (e.g. a meta/polling line). */
  children?: ReactNode;
  className?: string;
}

/**
 * The ONE editorial empty/error panel for API-quiet surfaces (aesthetic rehaul,
 * Pass-1 #4). Anatomy: icon → mono eyebrow → Source Serif heading → calm body →
 * amber retry → footer. role="alert" announces genuine failures assertively;
 * "status" stays calm for empty/all-clear. It NEVER renders a raw HTTP status.
 * Loading uses <Skeleton>, not this panel. Server-safe (no hooks); consumers
 * passing onRetry are already client components.
 */
export function StatePanel({
  icon,
  eyebrow,
  title,
  body,
  role = "status",
  label,
  onRetry,
  retryLabel = "Try again",
  children,
  className,
}: StatePanelProps) {
  return (
    <div role={role} aria-label={label} className={cn(styles.panel, className)}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      <h2 className={styles.title}>{title}</h2>
      {body ? <p className={styles.body}>{body}</p> : null}
      {onRetry ? (
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
      ) : null}
      {children ? <div className={styles.footer}>{children}</div> : null}
    </div>
  );
}
