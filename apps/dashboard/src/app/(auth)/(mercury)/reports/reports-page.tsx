"use client";

import { useEffect, useState } from "react";
import { useReportWindow } from "./hooks/use-report-window";
import { useReportData } from "./hooks/use-report-data";
import { useConnections } from "@/hooks/use-connections";
import { isMercuryToolLive } from "@/lib/route-availability";
import { PageHead, type RefreshState } from "./components/page-head";
import { NoConnectionBanner } from "./components/no-connection-banner";
import { PullQuote } from "./components/pull-quote";
import { Attribution } from "./components/attribution";
import { Funnel } from "./components/funnel";
import { Campaigns } from "./components/campaigns";
import { CostVsValue } from "./components/cost-vs-value";
import { ManagedComparison } from "./components/managed-comparison";
import { Colophon } from "./components/colophon";
import { FixtureModeBanner } from "./components/fixture-mode-banner";
import { ReportsUnavailable } from "./components/reports-unavailable";
import { ReportsSkeleton } from "./components/reports-skeleton";
import { StaleDataBanner } from "./components/stale-data-banner";
import styles from "./reports.module.css";

// Org placeholder until session/org context resolution lands (spec §10.7).
const ORG_PLACEHOLDER = "Aurora Aesthetics";

export function ReportsPage() {
  const { window: activeWindow, setWindow } = useReportWindow();
  const { data: fx, isLoading, isFetching, error, refresh, retry } = useReportData(activeWindow);
  const liveMode = isMercuryToolLive("reports");

  // Refresh state machine (per spec §4.2 + plan revision R6):
  // Refresh → Refreshing… → Still loading… at 3s.
  // Window buttons stay enabled during refresh; React Query keys cleanly
  // separate per-window state.
  const [stillLoading, setStillLoading] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  useEffect(() => {
    if (!isFetching) {
      setStillLoading(false);
      setCacheAge(0);
      return;
    }
    const t = setTimeout(() => setStillLoading(true), 3000);
    return () => clearTimeout(t);
  }, [isFetching]);

  useEffect(() => {
    if (cacheAge == null) return;
    const t = setInterval(() => setCacheAge((a) => (a == null ? null : a + 1)), 60_000);
    return () => clearInterval(t);
  }, [cacheAge]);

  const refreshState: RefreshState = isFetching
    ? stillLoading
      ? "still-loading"
      : "refreshing"
    : "idle";

  // No-connection banner (per spec §4.3 + plan revision R7):
  // Reads from existing useConnections — never inferred from funnel data.
  // Banner appears ONLY when liveMode AND a meta-ads connection is missing
  // or not in 'connected' state. Never appears in fixture mode.
  const { data: connectionsData } = useConnections();
  const metaConn = connectionsData?.connections.find((c) => c.serviceId === "meta-ads");
  const showNoConnBanner = liveMode && (!metaConn || metaConn.status !== "connected");

  return (
    <div className={styles.reportsPage}>
      <FixtureModeBanner />
      <PageHead
        dateFolio={fx?.dateFolio ?? null}
        activeWindow={activeWindow}
        onSelectWindow={setWindow}
        onRefresh={() => void refresh()}
        refreshState={refreshState}
        cacheAge={cacheAge}
      />

      {showNoConnBanner && <NoConnectionBanner />}

      {!fx && isLoading && <ReportsSkeleton />}

      {!fx && !isLoading && error && <ReportsUnavailable onRetry={() => void retry()} />}

      {fx && (
        <>
          {error && <StaleDataBanner cacheAge={cacheAge} onRetry={() => void retry()} />}
          <PullQuote q={fx.pullquote} />
          <Attribution data={fx.attribution} />
          <Funnel rows={fx.funnel} narrative={fx.funnelNarrative} />
          <Campaigns campaigns={fx.campaigns} />
          <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
          {fx.managedComparison && <ManagedComparison data={fx.managedComparison} />}
          <Colophon
            period={fx.period}
            org={ORG_PLACEHOLDER}
            generatedAt={new Date()}
            liveMode={liveMode}
          />
        </>
      )}
    </div>
  );
}
