"use client";

import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRightDrawer } from "@/components/layout/right-drawer-context";
import {
  OpportunityStageSchema,
  type OpportunityStage,
  type PipelineBoardOpportunity,
} from "@switchboard/schemas";
import { PIPELINE_STAGES } from "./column";
import { formatSGD, relTime } from "./format";
import styles from "../pipeline.module.css";

const STAGE_LABEL: Record<OpportunityStage, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.key, s.label]),
) as Record<OpportunityStage, string>;

export function DetailDrawer({
  opportunity,
  now,
  onStageChange,
}: {
  opportunity: PipelineBoardOpportunity | null;
  now: Date;
  onStageChange: (input: { id: string; stage: OpportunityStage }) => void;
}) {
  const drawer = useRightDrawer();
  const open = drawer.kind === "opportunity" && opportunity !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? drawer.open("opportunity") : drawer.close())}
    >
      <SheetContent side="right" className={styles.detailDrawer} aria-describedby={undefined}>
        {opportunity && (
          <>
            <SheetHeader>
              <span className={styles.eyebrow} data-tone="accent">
                {STAGE_LABEL[opportunity.stage]}
              </span>
              <SheetTitle className={styles.detailServiceName}>
                {opportunity.serviceName}
              </SheetTitle>
              <SheetDescription className={styles.detailContactName}>
                {opportunity.contact.name}
              </SheetDescription>
            </SheetHeader>

            <div className={styles.detailBody}>
              <Field label="value">
                <span data-tabular className={styles.detailValue}>
                  {opportunity.estimatedValue == null
                    ? "not estimated"
                    : formatSGD(opportunity.estimatedValue, { forceZero: true })}
                </span>
                {opportunity.revenueTotal > 0 && (
                  <span data-tabular className={styles.detailRevenue}>
                    {" · "}
                    {formatSGD(opportunity.revenueTotal, { forceZero: true })} captured
                  </span>
                )}
                {opportunity.stage === "won" && opportunity.revenueTotal === 0 && (
                  <p className={styles.detailRevenueHint}>
                    Recorded as won. Revenue is captured separately.
                  </p>
                )}
              </Field>

              <Field label="timeline">
                {opportunity.timeline ?? "unknown"}
                {" · price · "}
                {opportunity.priceReadiness ?? "unknown"}
              </Field>

              {opportunity.assignedStaff && (
                <Field label="staff">{opportunity.assignedStaff}</Field>
              )}

              {opportunity.objections.length > 0 && (
                <Field label="objections">
                  <ul className={styles.detailObjections}>
                    {opportunity.objections.map((o, i) => (
                      <li key={i}>
                        <span
                          className={styles.detailObjectionDot}
                          data-resolved={o.resolvedAt ? "true" : "false"}
                          aria-hidden="true"
                        />
                        {o.category.replace(/_/g, " ")}
                        <span className={styles.detailObjectionTime}>
                          {" · "}
                          {relTime(o.raisedAt, now)}
                        </span>
                        {o.resolvedAt && (
                          <span className={styles.detailObjectionResolved}> · resolved</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Field>
              )}

              {opportunity.notes && <Field label="notes">{opportunity.notes}</Field>}

              {opportunity.lostReason && (
                <Field label="lost reason">
                  <span className={styles.detailLostReason}>{opportunity.lostReason}</span>
                </Field>
              )}

              <Field label="qualification">
                {opportunity.qualificationComplete ? (
                  <span className={styles.detailQualified}>complete</span>
                ) : (
                  <span className={styles.detailQualifiedNo}>incomplete</span>
                )}
              </Field>

              <Field label="stage">
                <select
                  className={styles.detailStageSelect}
                  value={opportunity.stage}
                  onChange={(e) =>
                    onStageChange({
                      id: opportunity.id,
                      stage: OpportunityStageSchema.parse(e.target.value),
                    })
                  }
                  aria-label="Change stage"
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="dates">
                <div className={styles.detailDates} data-tabular>
                  <span>opened</span>
                  <span>{relTime(opportunity.openedAt, now)}</span>
                  <span>updated</span>
                  <span>{relTime(opportunity.updatedAt, now)}</span>
                  {opportunity.closedAt && (
                    <>
                      <span>closed</span>
                      <span>{relTime(opportunity.closedAt, now)}</span>
                    </>
                  )}
                </div>
              </Field>
            </div>

            <div className={styles.detailFooter}>
              <Link
                href={`/contacts/${opportunity.contactId}`}
                className={styles.detailOpenContact}
              >
                Open contact →
              </Link>
              <button type="button" className={styles.detailClose} onClick={() => drawer.close()}>
                Close
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.detailField}>
      <span className={styles.eyebrow}>{label}</span>
      <div className={styles.detailFieldValue}>{children}</div>
    </div>
  );
}
