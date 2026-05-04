import type { PipelineViewModel, PipelineTileViewModel } from "@/lib/agent-home/types";
import { resolveAgentHomeLink } from "@/lib/agent-home/resolve-link";
import { FixtureFolioBadge } from "./fixture-folio-badge";

function Tile({ tile }: { tile: PipelineTileViewModel }) {
  const resolved = resolveAgentHomeLink(tile.link);
  const inner = (
    <>
      <span className="tile-stage">{tile.stage.toUpperCase()}</span>
      <span className="tile-name">{tile.name}</span>
      <span className="tile-ctx">
        <em>{tile.ctx}</em>
      </span>
      <span className="tile-bar" />
    </>
  );

  if (resolved.disabled) {
    return (
      <span className="tile" data-stage={tile.stage} aria-disabled="true">
        {inner}
      </span>
    );
  }
  return (
    <a className="tile" data-stage={tile.stage} href={resolved.href}>
      {inner}
    </a>
  );
}

function emptyCopy(vm: PipelineViewModel): string {
  if (vm.agentKey === "riley") {
    return "Riley will surface ad sets here when they need a decision.";
  }
  return "No active leads yet. They'll appear here as conversations open.";
}

export function PipelineBlock({ vm }: { vm: PipelineViewModel }) {
  const setupResolved = resolveAgentHomeLink(vm.setupLink);

  return (
    <section className="section page-wide" data-block="pipeline">
      <div className="folio">
        <span className="folio-l">Pipeline</span>
        <span className="folio-r">
          {vm.totalCount} {vm.countNoun}
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      {vm.tiles.length === 0 ? (
        <p className="empty-state">
          <em>{emptyCopy(vm)}</em>
        </p>
      ) : (
        <div className="pipeline-wrap">
          <div className="pipeline-scroll">
            {vm.tiles.map((t) => (
              <Tile key={t.id} tile={t} />
            ))}
          </div>
        </div>
      )}
      {setupResolved.disabled ? (
        <span className="setup-link" aria-disabled="true">
          Manage {vm.agentKey === "alex" ? "Alex" : "Riley"}&apos;s setup →
        </span>
      ) : (
        <a className="setup-link" href={setupResolved.href}>
          Manage {vm.agentKey === "alex" ? "Alex" : "Riley"}&apos;s setup →
        </a>
      )}
    </section>
  );
}
