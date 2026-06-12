"use client";

import { useRouter } from "next/navigation";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import { useMiraDesk } from "@/hooks/use-mira-desk";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import { T } from "@/components/cockpit/tokens";
import styles from "./agent-panel.module.css";

/**
 * Enablement-aware Mira drill-in (minimal parity: portrait + live ready count +
 * route out; full 4-slot parity lands with the M1 enablement backlog). The
 * letter-disc monogram is retired: PrintedPortraitAvatar is the one frame.
 */
export function MiraPanel() {
  const router = useRouter();
  const { enabled } = useMiraEnabled();
  // Desk read-model only when enabled (the API 404s otherwise).
  const deskQ = useMiraDesk(enabled ?? false);

  if (enabled) {
    const ready = deskQ.data?.readyToReviewCount;
    // D9-F3 — roll up the desk's attention bucket so a dead-lettered publishing
    // attempt is visible on the Home drill-in, not only inside Mira's workspace.
    const attention = deskQ.data?.needsAttention?.length ?? 0;
    return (
      <div className={styles.notset}>
        <PrintedPortraitAvatar agentKey="mira" size={84} hero />
        <h3 className={styles.notsetHeading}>Mira is set up</h3>
        <p className={styles.notsetSub}>
          Review her latest creative drafts and decide what moves forward.
        </p>
        {typeof ready === "number" ? (
          <span className={styles.notsetMeta}>
            {ready === 0
              ? "No drafts waiting"
              : `${ready} draft${ready === 1 ? "" : "s"} ready to review`}
          </span>
        ) : null}
        {attention > 0 ? (
          <span className={styles.notsetMeta} style={{ color: T.red }}>
            {`${attention} draft${attention === 1 ? "" : "s"} ${
              attention === 1 ? "needs" : "need"
            } attention`}
          </span>
        ) : null}
        <button type="button" className={styles.miraOpenCta} onClick={() => router.push("/mira")}>
          Open Mira&apos;s workspace &rarr;
        </button>
      </div>
    );
  }

  return (
    <div className={styles.notset}>
      <PrintedPortraitAvatar agentKey="mira" size={84} hero showPip={false} />
      <h3 className={styles.notsetHeading}>Mira isn&apos;t set up yet</h3>
      <p className={styles.notsetSub}>
        Mira handles creative and content. She becomes available as your workspace grows.
      </p>
      <span className={styles.notsetMeta}>Coming soon</span>
    </div>
  );
}
