"use client";

import { useRouter } from "next/navigation";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import styles from "./agent-panel.module.css";

/**
 * Enablement-aware Mira drill-in. When Mira is enabled for the org, offer to
 * open her review feed (/mira). Otherwise show the honest "not set up" body —
 * no dead anchors, no fabricated capability claims.
 */
export function MiraPanel() {
  const router = useRouter();
  const { enabled } = useMiraEnabled();

  if (enabled) {
    return (
      <div className={styles.notset}>
        <div className={styles.notsetMark} aria-hidden="true">
          M
        </div>
        <h3 className={styles.notsetHeading}>Mira is set up</h3>
        <p className={styles.notsetSub}>
          Review her latest creative drafts and decide what moves forward.
        </p>
        <button type="button" onClick={() => router.push("/mira")}>
          Open Mira&apos;s workspace →
        </button>
      </div>
    );
  }

  return (
    <div className={styles.notset}>
      <div className={styles.notsetMark} aria-hidden="true">
        M
      </div>
      <h3 className={styles.notsetHeading}>Mira isn&apos;t set up yet</h3>
      <p className={styles.notsetSub}>
        Mira handles creative and content. She becomes available as your workspace grows.
      </p>
      <span className={styles.notsetMeta}>Coming soon</span>
    </div>
  );
}
