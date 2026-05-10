import type { ContactDetailThread } from "@switchboard/schemas";
import { ROUTE_AVAILABILITY } from "@/lib/agent-home/resolve-link";
import styles from "../contact-detail.module.css";
import { relativeAge } from "./format";

export function ThreadsSection({ items }: { items: ContactDetailThread[] }) {
  // 1:1 invariant — at most one thread per contact in D1.5.
  const thread = items[0];
  const threadOpen = ROUTE_AVAILABILITY.thread;
  return (
    <section className={styles.section}>
      <p className="section-label">
        Conversation threads
        {!threadOpen ? <span className={styles.subLabel}>· opening soon</span> : null}
      </p>
      {!thread ? (
        <p className={styles.empty}>No conversation thread yet.</p>
      ) : threadOpen ? (
        <a className={styles.threadTile} href={`/threads/${thread.id}`}>
          <p className={styles.threadMeta}>
            <span>{thread.assignedAgent}</span>
            {thread.lastMessageAt ? (
              <>
                <span className={styles.dot} aria-hidden="true" />
                <span>{relativeAge(thread.lastMessageAt)}</span>
              </>
            ) : null}
          </p>
          <p className={styles.threadSummary}>{thread.summary}</p>
        </a>
      ) : (
        <div
          className={styles.threadTileDisabled}
          aria-disabled="true"
          title="Conversation view coming next"
        >
          <p className={styles.threadMeta}>
            <span>{thread.assignedAgent}</span>
            {thread.lastMessageAt ? (
              <>
                <span className={styles.dot} aria-hidden="true" />
                <span>{relativeAge(thread.lastMessageAt)}</span>
              </>
            ) : null}
          </p>
          <p className={styles.threadSummary}>{thread.summary}</p>
        </div>
      )}
    </section>
  );
}
