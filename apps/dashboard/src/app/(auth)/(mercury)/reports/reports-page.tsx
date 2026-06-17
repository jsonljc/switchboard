"use client";

import { useEffect, useState } from "react";
import { useReportWindow } from "./hooks/use-report-window";
import { useReportData } from "./hooks/use-report-data";
import { useConnections } from "@/hooks/use-connections";
import { useOrgConfig } from "@/hooks/use-org-config";
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

// Graceful stand-in for the colophon's `org · <name>` line while the org
// config query is still resolving (or its keys are pending). Never a fake
// clinic name — just a neutral label.
const ORG_NAME_FALLBACK = "Your clinic";

export function ReportsPage() {
  const { window: activeWindow, setWindow } = useReportWindow();
  const { data: fx, isFetching, error, refresh, retry } = useReportData(activeWindow);
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
      // Only reset the cache age on a SUCCESSFUL settle. On an error settle the
      // visible data is whatever last succeeded, so keep counting its true age —
      // otherwise the stale banner would dishonestly claim "moments ago".
      if (!error) setCacheAge(0);
      return;
    }
    const t = setTimeout(() => setStillLoading(true), 3000);
    return () => clearTimeout(t);
  }, [isFetching, error]);

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

  // Colophon org name: the signed-in org from useOrgConfig. Falls back to a
  // neutral label while the query (or its session/org keys) is still pending —
  // never a hardcoded clinic name.
  const { data: orgConfigData } = useOrgConfig();
  const orgName = orgConfigData?.config.name ?? ORG_NAME_FALLBACK;

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

      {/* Exhaustive over {fx, error}: when there is no data, either we are still
          loading (incl. React Query's enabled:false pending state while the
          session/org keys resolve) or the load errored. Never a blank body. */}
      {!fx && !error && <ReportsSkeleton />}

      {!fx && error && <ReportsUnavailable onRetry={() => void retry()} />}

      {fx && (
        <>
          {error && <StaleDataBanner cacheAge={cacheAge} onRetry={() => void retry()} />}
          <PullQuote q={fx.pullquote} />
          <Attribution data={fx.attribution} />
          <Funnel rows={fx.funnel} narrative={fx.funnelNarrative} />
          <Campaigns campaigns={fx.campaigns} />
          <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
          {fx.managedComparison && <ManagedComparison data={fx.managedComparison} />}
          <Colophon period={fx.period} org={orgName} generatedAt={new Date()} liveMode={liveMode} />
        </>
      )}
    </div>
  );
}
