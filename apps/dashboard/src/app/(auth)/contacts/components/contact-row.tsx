"use client";

import Link from "next/link";
import type { ContactBrowseRow } from "@switchboard/schemas";
import styles from "../contacts.module.css";
import { channelLabel, relativeAge, stageLabel } from "./format";

export interface ContactRowProps {
  row: ContactBrowseRow;
  /** Injected for deterministic relative-age formatting in tests. */
  now?: Date;
}

export function ContactRow({ row, now }: ContactRowProps) {
  return (
    <tr>
      <td>
        <Link
          href={row.detailHref}
          className={styles.cellName}
          aria-label={`Open ${row.displayName}`}
        >
          {row.displayName}
        </Link>
      </td>
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
