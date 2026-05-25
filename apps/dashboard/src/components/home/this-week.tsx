import type { CSSProperties } from "react";
import Link from "next/link";
import type { ThisWeekModel } from "./types";
import styles from "./this-week.module.css";

interface ThisWeekProps {
  model?: ThisWeekModel;
}

/**
 * ThisWeek — the agent's warm, editorial "week-so-far" note on the Home screen.
 *
 * Presentational only: receives a pre-composed ThisWeekModel, never fetches.
 *
 * NEVER fabricates metrics. If none of the core numeric fields are present, or if
 * the model is undefined, the component renders a quiet skeleton/placeholder instead
 * of inventing numbers. Every digit that appears on screen comes directly from
 * a model field.
 *
 * Layout:
 *   - Header: author identity (avatar initial + name + "week-so-far note")
 *   - Body: warm prose composed from only the present metric fields (drop cap)
 *   - Optional PS (model.ps)
 *   - Signoff (— {authorName})
 *   - Footer: "Read full report →" link to model.reportHref
 */
export function ThisWeek({ model }: ThisWeekProps) {
  const hasMetrics =
    model !== undefined &&
    (model.bookedConsults !== undefined ||
      model.newLeads !== undefined ||
      model.replyTime !== undefined ||
      model.costPerLead !== undefined);

  // Skeleton / empty state — no model or no metrics present.
  if (!model || !hasMetrics) {
    const skeletonName = model?.authorName ?? "Alex";
    const skeletonKey = model?.authorKey ?? "alex";
    const avatarStyle: CSSProperties = {
      background: `hsl(var(--agent-${skeletonKey}))`,
    };
    const articleStyle = {
      "--week-author-color": `hsl(var(--agent-${skeletonKey}))`,
    } as CSSProperties;

    return (
      <article className={styles.weeknote} aria-label="This week note" style={articleStyle}>
        <header className={styles.weeknoteHead}>
          <span className={styles.weeknoteFrom}>
            <span className={styles.weeknoteFromAv} style={avatarStyle} aria-hidden="true">
              {skeletonName[0]}
            </span>
            <span className={styles.weeknoteFromName}>{skeletonName}</span>
            <span className={styles.weeknoteFromMeta}>· week-so-far note</span>
          </span>
          <span className={styles.weeknoteTime}>Mon → today</span>
        </header>
        <p className={styles.weeknoteBody}>
          <em>Your week&rsquo;s still being tallied — check back soon.</em>
        </p>
        <span className={styles.weeknoteSignoff}>
          <span className={styles.weeknoteSignoffMark} style={avatarStyle} aria-hidden="true">
            {skeletonName[0]}
          </span>
          {skeletonName}
        </span>
      </article>
    );
  }

  const {
    authorName,
    authorKey,
    bookedConsults,
    newLeads,
    replyTime,
    costPerLead,
    ps,
    reportHref,
  } = model;

  const avatarStyle: CSSProperties = {
    background: `hsl(var(--agent-${authorKey}))`,
  };
  const articleStyle = {
    "--week-author-color": `hsl(var(--agent-${authorKey}))`,
  } as CSSProperties;

  // Build the prose clauses from only the fields that are actually present.
  // Each clause is a React node so numbers can be wrapped in a styled span.
  const clauses: React.ReactNode[] = [];

  if (bookedConsults !== undefined) {
    clauses.push(
      <span key="consults">
        <span className={styles.num}>{bookedConsults}</span> consult
        {bookedConsults !== 1 ? "s" : ""} booked
      </span>,
    );
  }
  if (newLeads !== undefined) {
    clauses.push(
      <span key="leads">
        <span className={styles.num}>{newLeads}</span> new lead{newLeads !== 1 ? "s" : ""} in
      </span>,
    );
  }
  if (replyTime !== undefined) {
    clauses.push(
      <span key="reply">
        replies averaging <span className={styles.num}>{replyTime}</span>
      </span>,
    );
  }
  if (costPerLead !== undefined) {
    clauses.push(
      <span key="cpl">
        cost per lead at <span className={styles.num}>{costPerLead}</span>
      </span>,
    );
  }

  // Interleave clauses with ", " connectors, replacing the last separator with " — ".
  const prose: React.ReactNode[] = [];
  clauses.forEach((clause, i) => {
    prose.push(clause);
    if (i < clauses.length - 2) {
      prose.push(", ");
    } else if (i === clauses.length - 2) {
      prose.push(" — ");
    }
  });

  return (
    <article className={styles.weeknote} aria-label="This week note" style={articleStyle}>
      <header className={styles.weeknoteHead}>
        <span className={styles.weeknoteFrom}>
          <span className={styles.weeknoteFromAv} style={avatarStyle} aria-hidden="true">
            {authorName[0]}
          </span>
          <span className={styles.weeknoteFromName}>{authorName}</span>
          <span className={styles.weeknoteFromMeta}>· week-so-far note</span>
        </span>
        <span className={styles.weeknoteTime}>Mon → today</span>
      </header>

      <p className={`${styles.weeknoteBody} ${styles.dropcap}`}>{prose}</p>

      {ps && <p className={styles.weeknotePs}>{ps}</p>}

      <span className={styles.weeknoteSignoff}>
        <span className={styles.weeknoteSignoffMark} style={avatarStyle} aria-hidden="true">
          {authorName[0]}
        </span>
        {authorName}
      </span>

      <Link href={reportHref} className={styles.weeknoteFoot}>
        Read full report <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
