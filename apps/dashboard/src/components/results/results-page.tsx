"use client";

import { useEffect, useState } from "react";
import { useReportWindow } from "@/app/(auth)/(mercury)/reports/hooks/use-report-window";
import { useReportData } from "@/app/(auth)/(mercury)/reports/hooks/use-report-data";
import { useConnections } from "@/hooks/use-connections";
import { isMercuryToolLive } from "@/lib/route-availability";
import { buildResultsModel } from "./results-model";
import { ResultsHeader } from "./results-header";
import { VerdictLine } from "./verdict-line";
import { HeroOutcomes } from "./hero-outcomes";
import { WhatsWorking } from "./whats-working";
import { AgentContribution } from "./agent-contribution";
import { WorthIt } from "./worth-it";
import { DetailsDisclosure } from "./details-disclosure";
import { FunnelSection } from "./funnel-section";
import { CampaignsSection } from "./campaigns-section";
import { ManagedComparison } from "./managed-comparison";
import { Colophon } from "./colophon";
import { MetaConnectBanner, ErrorBanner, FirstRunNote, ResultsSkeleton } from "./states";
import styles from "./results.module.css";

export function ResultsPage() {
  const { window: w, setWindow } = useReportWindow();
  const { data, isLoading, isFetching, error, refresh } = useReportData(w);
  const liveMode = isMercuryToolLive("reports");

  // ── Cache-age state machine (mirrors reports-page.tsx §4.2) ───────────────
  // Reset to 0 when a fetch completes; increment once per minute thereafter.
  const [cacheAgeMinutes, setCacheAgeMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!isFetching) {
      setCacheAgeMinutes(0);
      return;
    }
    // While fetching, don't tick — age is stale only after a completed load.
  }, [isFetching]);

  useEffect(() => {
    if (cacheAgeMinutes == null) return;
    const t = setInterval(() => setCacheAgeMinutes((a) => (a == null ? null : a + 1)), 60_000);
    return () => clearInterval(t);
  }, [cacheAgeMinutes]);

  const isRecomputing = isFetching;

  // ── Meta connection gate ───────────────────────────────────────────────────
  const { data: connections } = useConnections();
  // TODO(verify serviceId): API resolver queries "meta"; confirm canonical id
  const metaConn = connections?.connections.find((c) => c.serviceId === "meta-ads");
  const showNoMeta = liveMode && (!metaConn || metaConn.status !== "connected");

  // ── SSR/test-safe responsive layout ───────────────────────────────────────
  // jsdom has no matchMedia → stays "mobile" in tests (avoids ReferenceError).
  const [layout, setLayout] = useState<"mobile" | "desktop">("mobile");
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    setLayout(mq.matches ? "desktop" : "mobile");
    function handleChange(e: MediaQueryListEvent) {
      setLayout(e.matches ? "desktop" : "mobile");
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  // ── Body rendering (avoid inline IIFE — local fn for readability) ─────────
  function renderBody() {
    if (isLoading) return <ResultsSkeleton />;
    if (!data) return <FirstRunNote />;

    const model = buildResultsModel(data);
    const firstRun = model.attribution.total === 0 && model.bookings === 0;
    if (firstRun) return <FirstRunNote />;

    return (
      <>
        <VerdictLine pullquote={model.pullquote} />
        <HeroOutcomes model={model} />
        <WhatsWorking model={model} />
        <AgentContribution attribution={model.attribution} />
        <WorthIt cost={model.cost} narrative={model.costNarrative} />
        <DetailsDisclosure>
          {!showNoMeta && <FunnelSection funnel={model.funnel} narrative={model.funnelNarrative} />}
          <CampaignsSection campaigns={model.campaigns} layout={layout} />
          {model.managedComparison && <ManagedComparison data={model.managedComparison} />}
        </DetailsDisclosure>
        <Colophon
          period={model.period}
          label={model.window}
          isLive={liveMode}
          generatedAt={new Date()}
        />
      </>
    );
  }

  return (
    <div className={styles.column}>
      <ResultsHeader
        window={w}
        onWindow={setWindow}
        dateFolio={data?.dateFolio ?? null}
        cacheAgeMinutes={cacheAgeMinutes}
        onRecompute={() => void refresh()}
        isRecomputing={isRecomputing}
        isLive={liveMode}
      />
      {error && (
        <ErrorBanner cacheAgeMinutes={cacheAgeMinutes ?? 0} onRetry={() => void refresh()} />
      )}
      {showNoMeta && <MetaConnectBanner />}
      {renderBody()}
    </div>
  );
}
