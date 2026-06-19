import { cn } from "@/lib/utils";
import styles from "./skeleton.module.css";

/**
 * Token-correct loading placeholder. The legacy `ui/skeleton` used the shadcn
 * `bg-muted` semantic (audit B1); this consumes the editorial register — a warm
 * `var(--hairline)` block with a calm opacity pulse. Decorative (aria-hidden);
 * the surrounding region carries role="status". Size via className
 * (`<Skeleton className="h-48" />`). Server-safe (no hooks).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn(styles.skeleton, className)} {...props} />;
}
