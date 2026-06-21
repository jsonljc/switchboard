// Thin adapter: /reports Colophon maps liveMode -> isLive for the shared implementation.
import { Colophon as SharedColophon } from "@/components/reports-shared/colophon";

export interface ColophonProps {
  period: string;
  org: string;
  generatedAt: Date;
  liveMode: boolean;
}

export function Colophon({ period, org, generatedAt, liveMode }: ColophonProps) {
  return <SharedColophon period={period} org={org} generatedAt={generatedAt} isLive={liveMode} />;
}
