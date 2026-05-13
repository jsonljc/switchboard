"use client";

import { useReportWindow } from "./hooks/use-report-window";
import { useReportData } from "./hooks/use-report-data";
import { ReportsHeader } from "./components/header";
import { TitleControls } from "./components/title-controls";
import { PullQuote } from "./components/pull-quote";
import { Attribution } from "./components/attribution";
import { Funnel } from "./components/funnel";
import { Campaigns } from "./components/campaigns";
import { CostVsValue } from "./components/cost-vs-value";
import { ReportFooter } from "./components/report-footer";
import { Disclosure } from "./components/disclosure";
import styles from "./reports.module.css";

export function ReportsPage() {
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
        <Attribution data={fx.attribution} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <Funnel rows={fx.funnel} narrative={fx.funnelNarrative} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <Campaigns campaigns={fx.campaigns} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
        <ReportFooter activeWindow={activeWindow} cost={fx.cost} />
      </section>

      {/* Page-level colophon — sits below all sections so future spacing
          edits to cost-vs-value can't drag it along. */}
      <section className={`${styles.section} ${styles.page}`}>
        <Disclosure />
      </section>
    </div>
  );
}
