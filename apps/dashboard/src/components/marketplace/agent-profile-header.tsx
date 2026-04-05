import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { TrustBar } from "@/components/marketplace/trust-bar";

interface AgentProfileHeaderProps {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
  autonomyLevel: string;
  roleFocus: RoleFocus;
  bundleSlug: string;
}

export function AgentProfileHeader({
  name,
  description,
  trustScore,
  autonomyLevel,
  roleFocus,
  bundleSlug,
}: AgentProfileHeaderProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-48 h-48 mb-6">
        <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
      </div>

      <h1 className="font-display text-3xl lg:text-4xl font-light text-foreground">{name}</h1>

      <div className="flex items-center gap-3 mt-4">
        <TrustBar score={trustScore} />
        <span className="text-xs font-mono text-muted-foreground border border-border px-2 py-0.5 rounded">
          {autonomyLevel}
        </span>
      </div>

      <p className="mt-4 text-muted-foreground max-w-lg">{description}</p>

      <div className="mt-6">
        <Button asChild size="lg">
          <Link href={`/deploy/${bundleSlug}`}>Hire this agent</Link>
        </Button>
      </div>
    </div>
  );
}
