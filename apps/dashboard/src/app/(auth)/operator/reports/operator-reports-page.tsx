"use client";

import { useReportWindow } from "../../reports/hooks/use-report-window";
import { useReportData } from "../../reports/hooks/use-report-data";
import { ReportsHeader } from "../../reports/components/header";
import { TitleControls } from "../../reports/components/title-controls";
import { PullQuote } from "../../reports/components/pull-quote";
import { Attribution } from "../../reports/components/attribution";
import { Funnel } from "../../reports/components/funnel";
import { Campaigns } from "../../reports/components/campaigns";
import { CostVsValue } from "../../reports/components/cost-vs-value";
import { ReportFooter } from "../../reports/components/report-footer";
import { Disclosure } from "../../reports/components/disclosure";
import { ManagedComparison } from "./components/managed-comparison";
import styles from "../../reports/reports.module.css";

export function OperatorReportsPage() {
  const { window: activeWindow, setWindow } = useReportWindow();
  const { data: fx } = useReportData(activeWindow);

  if (!fx) return null;

  return (
    <div className={styles.reportsPage}>
      <ReportsHeader />
      <section className={`${styles.section} ${styles.page}`}>
        <TitleControls
          dateFolio={fx.dateFolio}
          activeWindow={activeWindow}
          onSelectWindow={setWindow}
        />
      </section>
      <section className={`${styles.section} ${styles.page}`}>
        <PullQuote q={fx.pullquote} />
      </section>
      <section className={`${styles.section} ${styles.page}`}>
        <Attribution data={fx.attribution} period={fx.period} />
      </section>
      <section className={`${styles.section} ${styles.page}`}>
        <Funnel data={fx.funnel} narrative={fx.funnelNarrative} period={fx.period} />
      </section>
      {fx.managedComparison && (
        <section className={`${styles.section} ${styles.page}`}>
          <ManagedComparison data={fx.managedComparison} period={fx.period} />
        </section>
      )}
      <section className={`${styles.section} ${styles.page}`}>
        <Campaigns data={fx.campaigns} period={fx.period} />
      </section>
      <section className={`${styles.section} ${styles.page}`}>
        <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
        <ReportFooter activeWindow={activeWindow} cost={fx.cost} />
      </section>
      <section className={`${styles.section} ${styles.page}`}>
        <Disclosure />
      </section>
    </div>
  );
}
