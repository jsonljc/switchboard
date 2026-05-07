import type { AgentKey } from "@switchboard/schemas";
import type { HeroMetric, MetricsViewModel, StatCell } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";
import { Sparkline } from "./sparkline";

const SOURCE_LABEL: Record<string, string> = {
  "ad-platform-spend": "Spend",
  "ad-platform-ctr": "CTR",
  "attribution-revenue": "Revenue",
};

function HeroNumber({ hero }: { hero: HeroMetric }) {
  switch (hero.kind) {
    case "tours-booked":
      return (
        <h2 className="hero-num">
          <span className="accent">{hero.value} tours</span> <span className="light">booked</span>
        </h2>
      );
    case "ad-leads":
      return (
        <h2 className="hero-num">
          <span className="accent">{hero.value} leads</span> <span className="light">from ads</span>
        </h2>
      );
    case "creatives-shipped":
      return (
        <h2 className="hero-num">
          <span className="accent">{hero.value} creatives</span>{" "}
          <span className="light">shipped</span>
        </h2>
      );
    case "revenue-attributed":
      return (
        <h2 className="hero-num">
          <span className="accent">
            {hero.currency} {hero.value.toLocaleString()}
          </span>{" "}
          <span className="light">attributed</span>
        </h2>
      );
  }
}

function StatCellView({ cell }: { cell: StatCell }) {
  const display = cell.unavailable ? "—" : cell.display;
  return (
    <div className="stat-cell">
      <span className="stat-label">{cell.label}</span>
      <span className="stat-num" data-unavailable={cell.unavailable ? "true" : undefined}>
        {display}
      </span>
      <span className="stat-rule" />
    </div>
  );
}

function NoDataChip({ tokens }: { tokens: readonly string[] }) {
  if (tokens.length === 0) return null;
  const labels = tokens
    .map((t) => SOURCE_LABEL[t] ?? t)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  return <span className="folio-chip-nodata">· no data: {labels}</span>;
}

export function MetricsBlock({
  vm,
  agentKey: _agentKey,
}: {
  vm: MetricsViewModel;
  agentKey: AgentKey;
}) {
  const unavailable = vm.freshness.unavailableSources ?? [];
  return (
    <section className="section page-wide" data-block="metrics" data-testid="block-metrics">
      <div className="folio">
        <span className="folio-l">This week</span>
        <span className="folio-r">
          {vm.folioRange}
          <NoDataChip tokens={unavailable} />
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      <HeroNumber hero={vm.hero} />
      <p className="hero-sub">
        <ProseSegments segments={vm.heroSubProseSegments} />
      </p>
      <Sparkline data={vm.spark} />
      <div className="stats-row">
        {vm.stats.map((s) => (
          <StatCellView key={s.label} cell={s} />
        ))}
      </div>
    </section>
  );
}
