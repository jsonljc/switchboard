import type { AgentKey } from "@switchboard/schemas";
import type { GreetingViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";
import { PortraitAlex } from "./portrait/alex";
import { PortraitRiley } from "./portrait/riley";

function Portrait({ agentKey }: { agentKey: AgentKey }) {
  if (agentKey === "alex") return <PortraitAlex />;
  if (agentKey === "riley") return <PortraitRiley />;
  return null;
}

export function GreetingBlock({ vm, agentKey }: { vm: GreetingViewModel; agentKey: AgentKey }) {
  return (
    <section className="section page" data-block="greeting">
      <div className="folio">
        <span className="folio-l">Today</span>
        <span className="folio-r">
          {new Date(vm.freshness.generatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            weekday: "long",
          })}
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      <div className="greeting-block">
        <p className="greeting-prose">
          <ProseSegments segments={vm.segments} />
        </p>
        <div className="portrait" aria-label={agentKey}>
          <Portrait agentKey={agentKey} />
        </div>
      </div>
    </section>
  );
}
