"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryStates } from "@/components/query-states";
import { useReportWindow } from "@/app/(auth)/(mercury)/reports/hooks/use-report-window";
import { useReportData } from "@/app/(auth)/(mercury)/reports/hooks/use-report-data";
import { useConnections } from "@/hooks/use-connections";
import { isMercuryToolLive } from "@/lib/route-availability";
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import type { PanelAgentKey } from "@/components/agent-panel/lib/agent-display";
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
  const router = useRouter();
  const [panelAgent, setPanelAgent] = useState<PanelAgentKey | null>(null);
  const { window: w, setWindow } = useReportWindow();
  const { data, isFetching, error, refresh } = useReportData(w);
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
  // "meta-ads" is the canonical Connection serviceId (per cartridge-sdk service-registry).
  // NOTE: the API report resolver (apps/api/src/routes/dashboard-reports.ts) queries "meta" — a
  // separate API-side bug to fix before live mode; the dashboard is correct here.
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

  // ── Body rendering ─────────────────────────────────────────────────────────
  // QueryStates derives its branch from {data, error} only, so the live-mode
  // keys-pending window (data:undefined, error:null) resolves to "loading" and
  // shows the skeleton — not the old `if (!data) … FirstRunNote` false-empty.
  // The ErrorBanner above already explains a fetch failure, so the error branch
  // renders nothing (empty fragment — `error={null}` would NOT suppress the
  // ConnectionTrouble default, since `null ?? x === x`).
  function renderBody() {
    return (
      <QueryStates
        query={{ data, error }}
        loading={<ResultsSkeleton />}
        error={<></>}
        empty={<FirstRunNote />}
        isEmpty={(d) => {
          const m = buildResultsModel(d);
          return m.attribution.total === 0 && m.bookings === 0;
        }}
      >
        {(d) => {
          const model = buildResultsModel(d);
          return (
            <>
              <VerdictLine pullquote={model.pullquote} />
              <HeroOutcomes model={model} />
              <WhatsWorking model={model} />
              <AgentContribution attribution={model.attribution} onOpenAgent={setPanelAgent} />
              <WorthIt cost={model.cost} narrative={model.costNarrative} />
              {/* No-Meta hides BOTH funnel and campaigns (spec §State-coverage); hide the
                  whole disclosure when there's nothing left to reveal. */}
              {(!showNoMeta || model.managedComparison) && (
                <DetailsDisclosure>
                  {!showNoMeta && (
                    <FunnelSection funnel={model.funnel} narrative={model.funnelNarrative} />
                  )}
                  {!showNoMeta && <CampaignsSection campaigns={model.campaigns} layout={layout} />}
                  {model.managedComparison && <ManagedComparison data={model.managedComparison} />}
                </DetailsDisclosure>
              )}
              <Colophon
                period={model.period}
                label={model.window}
                isLive={liveMode}
                generatedAt={new Date()}
              />
            </>
          );
        }}
      </QueryStates>
    );
  }

  return (
    <>
      <div className={styles.column}>
        <ResultsHeader
          window={w}
          onWindow={setWindow}
          dateFolio={data?.dateFolio ?? null}
          cacheAgeMinutes={cacheAgeMinutes}
          onRecompute={() => void refresh()}
          isRecomputing={isRecomputing}
        />
        {error && (
          <ErrorBanner cacheAgeMinutes={cacheAgeMinutes ?? 0} onRetry={() => void refresh()} />
        )}
        {showNoMeta && <MetaConnectBanner />}
        {renderBody()}
      </div>

      {/* Agent panel — decoupled local state, mirrors Home's pattern.
          onSeeAll from Results is same-page navigation — omitted (no-op would be confusing). */}
      {panelAgent && (
        <AgentPanel
          key={panelAgent}
          agentKey={panelAgent}
          open
          onOpenChange={(o) => {
            if (!o) setPanelAgent(null);
          }}
          onOpenDecision={() => router.push("/inbox")}
          onActivate={() => router.push("/settings/channels")}
        />
      )}
    </>
  );
}
