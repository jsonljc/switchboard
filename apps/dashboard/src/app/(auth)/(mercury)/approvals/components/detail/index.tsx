"use client";

import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";
import { DetailHeader } from "./header";
import { ConfirmationCode } from "./confirmation-code";
import { DetailEmpty } from "./empty";
import { useApprovalDetail } from "../../hooks/use-approvals";

export interface DetailProps {
  id: string | null;
  now: number;
}

export function Detail({ id, now }: DetailProps) {
  const { data: row, isLoading, isError } = useApprovalDetail(id);

  if (!id) return <DetailEmpty />;
  if (isLoading) {
    return (
      <div className={detailStyles.detailEmpty}>
        <span className={styles.eyebrow}>loading…</span>
      </div>
    );
  }
  if (isError || !row) {
    return (
      <div className={detailStyles.detailEmpty}>
        <span className={styles.eyebrow}>couldn't load</span>
        <p className={detailStyles.detailEmptySub}>
          We couldn't load this approval. Pick another card or refresh.
        </p>
      </div>
    );
  }

  return (
    <div className={detailStyles.detail}>
      <DetailHeader row={row} now={now} />
      <ConfirmationCode bindingHash={row.bindingHash} envelopeId={row.envelopeId} />
      <div className={styles.detailPlaceholder}>
        <span className={styles.eyebrow}>action drawer</span>
        <p>Approve and reject controls land in the next PR.</p>
      </div>
    </div>
  );
}
