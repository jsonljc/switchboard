"use client";

import { useReportWindow } from "../../(mercury)/reports/hooks/use-report-window";
import { useReportData } from "../../(mercury)/reports/hooks/use-report-data";
import { Topbar } from "../../(mercury)/reports/components/topbar";
import { PageHead } from "../../(mercury)/reports/components/page-head";
import { PullQuote } from "../../(mercury)/reports/components/pull-quote";
import { Attribution } from "../../(mercury)/reports/components/attribution";
import { Funnel } from "../../(mercury)/reports/components/funnel";
import { Campaigns } from "../../(mercury)/reports/components/campaigns";
import { CostVsValue } from "../../(mercury)/reports/components/cost-vs-value";
import { Colophon } from "../../(mercury)/reports/components/colophon";
import { ManagedComparison } from "../../(mercury)/reports/components/managed-comparison";
import styles from "../../(mercury)/reports/reports.module.css";

const ORG = "Aurora Aesthetics";
const USER = { display: "Operator", initials: "OP" };

export function OperatorReportsPage() {
  const { window: activeWindow, setWindow } = useReportWindow();
  const { data: fx, refresh } = useReportData(activeWindow);

  if (!fx) return null;

  return (
    <div className={styles.reportsPage}>
      <Topbar org={ORG} currentUser={USER} liveMode={false} />
      <PageHead
        dateFolio={fx.dateFolio}
        activeWindow={activeWindow}
        onSelectWindow={setWindow}
        onRefresh={() => void refresh()}
      />
      <PullQuote q={fx.pullquote} />
      <Attribution data={fx.attribution} />
      <Funnel rows={fx.funnel} narrative={fx.funnelNarrative} />
      <Campaigns campaigns={fx.campaigns} />
      <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
      {fx.managedComparison && <ManagedComparison data={fx.managedComparison} />}
      <Colophon period={fx.period} org={ORG} generatedAt={new Date()} liveMode={false} />
    </div>
  );
}
