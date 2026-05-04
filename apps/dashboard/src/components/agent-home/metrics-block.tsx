import type { AgentKey } from "@switchboard/schemas";
import type { HeroMetric, MetricsViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";
import { Sparkline } from "./sparkline";

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

export function MetricsBlock({
  vm,
  agentKey: _agentKey,
}: {
  vm: MetricsViewModel;
  agentKey: AgentKey;
}) {
  return (
    <section className="section page-wide" data-block="metrics">
      <div className="folio">
        <span className="folio-l">This week</span>
        <span className="folio-r">
          Mon — Fri
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
          <div key={s.label} className="stat-cell">
            <span className="stat-label">{s.label}</span>
            <span className="stat-num">{s.display}</span>
            <span className="stat-rule" />
          </div>
        ))}
      </div>
    </section>
  );
}
