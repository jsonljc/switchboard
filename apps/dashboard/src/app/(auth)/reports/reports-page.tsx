"use client";

import { FIXTURES_BY_WINDOW } from "./fixtures";
import { useReportWindow } from "./hooks/use-report-window";
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
  const fx = FIXTURES_BY_WINDOW[activeWindow];

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

      <section className={`${styles.section} ${styles.page}`}>
        <Campaigns data={fx.campaigns} period={fx.period} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
        <ReportFooter activeWindow={activeWindow} cost={fx.cost} />
        <Disclosure />
      </section>
    </div>
  );
}
