import type { ContactDetailThread } from "@switchboard/schemas";
import styles from "../contact-detail.module.css";
import { relativeAge } from "./format";

// `thread` is not an AgentHomeLink kind (no pipeline tile resolves to a
// thread route), so it stays out of route-availability.ts. Single consumer,
// flips to true when the /threads route ships.
const THREAD_ROUTE_LIVE = false;

export function ThreadsSection({ items }: { items: ContactDetailThread[] }) {
  // 1:1 invariant — at most one thread per contact in D1.5.
  const thread = items[0];
  const threadOpen = THREAD_ROUTE_LIVE;
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
