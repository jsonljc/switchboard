"use client";

import { useSearchParams } from "next/navigation";
import { TweaksPanel } from "./tweaks-panel";

export function TweaksPanelMount() {
  const params = useSearchParams();
  const hasTweaksFlag = params?.get("tweaks") === "1";
  return <TweaksPanel hasTweaksFlag={hasTweaksFlag} />;
}
