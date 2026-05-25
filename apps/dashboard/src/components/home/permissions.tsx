import Link from "next/link";
import type { PermissionsModel } from "./types";
import styles from "./home.module.css";

/**
 * Permissions — a single quiet line summarising what the team does without asking,
 * plus a link to tune it in Settings.
 *
 * Presentational only: renders the provided `summary` as plain text — no HTML injection.
 * Returns null when model is absent or summary is empty so no permissions claim is
 * fabricated.
 */
export function Permissions({ model }: { model?: PermissionsModel }) {
  if (!model || !model.summary) return null;

  return (
    <section className={styles.permsline}>
      <span className={styles.permslineText}>{model.summary}</span>
      <Link className={styles.permslineLink} href={model.adjustHref}>
        Adjust <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
