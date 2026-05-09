"use client";

import Link from "next/link";
import type { ContactBrowseRow } from "@switchboard/schemas";
import styles from "../contacts.module.css";
import { channelLabel, relativeAge, stageLabel } from "./format";

const ROW_DISABLED_TITLE = "Detail coming next";

export interface ContactRowProps {
  row: ContactBrowseRow;
  /** Source of truth: ROUTE_AVAILABILITY.contact, threaded from the page so the
   *  table component stays unaware of the gate. */
  detailEnabled: boolean;
  /** Injected for deterministic relative-age formatting in tests. */
  now?: Date;
}

export function ContactRow({ row, detailEnabled, now }: ContactRowProps) {
  const nameCell = detailEnabled ? (
    <Link href={row.detailHref} className={styles.cellName} aria-label={`Open ${row.displayName}`}>
      {row.displayName}
    </Link>
  ) : (
    <span className={styles.cellName}>{row.displayName}</span>
  );

  const trClasses = `${detailEnabled ? "" : styles.isDisabled}`.trim();
  const trProps = detailEnabled
    ? {}
    : ({ "aria-disabled": "true", title: ROW_DISABLED_TITLE } as const);

  return (
    <tr className={trClasses || undefined} {...trProps}>
      <td>{nameCell}</td>
      <td>
        <span className={styles.cellStage}>{stageLabel(row.stage)}</span>
      </td>
      <td>
        <span className={styles.cellChannel}>
          <span className={styles.cellChannelGlyph} aria-hidden="true" />
          {channelLabel(row.primaryChannel)}
        </span>
      </td>
      <td className={`${styles.cellOpps} ${row.opportunityCount === 0 ? styles.isMuted : ""}`}>
        {row.opportunityCount > 0 ? row.opportunityCount : "—"}
      </td>
      <td className={styles.isMuted}>{relativeAge(row.lastActivityAt, now)}</td>
      <td className={styles.isMuted}>{relativeAge(row.firstContactAt, now)}</td>
      <td className={styles.chevron} aria-hidden="true">
        ›
      </td>
    </tr>
  );
}
