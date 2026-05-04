import type { AgentKey } from "@switchboard/schemas";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { WinsViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";

export function WinsBlock({ vm, agentKey }: { vm: WinsViewModel; agentKey: AgentKey }) {
  const agentName = AGENT_REGISTRY[agentKey].displayName;
  return (
    <section className="section page-wide" data-block="wins">
      <div className="folio">
        <span className="folio-l">Recent wins</span>
        <span className="folio-r">
          Today
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      {vm.wins.length === 0 ? (
        <p className="empty-state">
          <em>No wins to show yet. {agentName} is still warming up.</em>
        </p>
      ) : (
        <div className="wins-grid">
          {vm.wins.map((w) => (
            <article key={w.id} className="win">
              <span className="win-folio">WIN — {w.timeFolio}</span>
              <p className="win-prose">
                <ProseSegments segments={w.proseSegments} />
              </p>
              <div className="win-foot">
                {w.undo.available && (
                  <button type="button" className="win-undo">
                    Undo
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
