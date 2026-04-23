import type { ModuleId, ModuleStatus } from "./module-types";

export interface Recommendation {
  moduleId: ModuleId | null;
  type: "fix" | "connect" | "continue" | "enable" | "all_live";
  message: string;
  href: string;
}

const SYNERGY_NEIGHBORS: Record<ModuleId, ModuleId[]> = {
  "lead-to-booking": ["ad-optimizer"],
  creative: ["ad-optimizer"],
  "ad-optimizer": ["creative", "lead-to-booking"],
};

const FIX_MESSAGES: Record<ModuleId, string> = {
  "lead-to-booking": "Fix calendar connection to restore lead conversion",
  creative: "Fix Creative connection to restore ad generation",
  "ad-optimizer": "Fix Meta Ads connection to restore spend optimization",
};

const ENABLE_MESSAGES: Record<string, string> = {
  "creative+ad-optimizer": "Activate Improve Spend to close the learning loop",
  "ad-optimizer+creative": "Add Create Ads to generate testable variants",
  "lead-to-booking+ad-optimizer": "Activate Improve Spend for closed-loop attribution",
  default: "Start with Convert Leads to capture and book revenue",
};

export function pickRecommendation(modules: ModuleStatus[]): Recommendation {
  const broken = modules.filter((m) => m.state === "connection_broken");
  if (broken.length > 0) {
    const target = broken[0];
    return {
      moduleId: target.id,
      type: "fix",
      message: FIX_MESSAGES[target.id],
      href: target.cta.href,
    };
  }

  const needsConn = modules.filter((m) => m.state === "needs_connection");
  if (needsConn.length > 0) {
    const target = needsConn[0];
    return {
      moduleId: target.id,
      type: "connect",
      message: `Connect to activate ${target.label}`,
      href: target.cta.href,
    };
  }

  const partial = modules.filter((m) => m.state === "partial_setup");
  if (partial.length > 0) {
    const target = partial[0];
    return {
      moduleId: target.id,
      type: "continue",
      message: `Finish setting up ${target.label} — ${target.subtext.toLowerCase()}`,
      href: target.cta.href,
    };
  }

  const notSetup = modules.filter((m) => m.state === "not_setup");
  if (notSetup.length > 0) {
    const liveModules = modules.filter((m) => m.state === "live");
    const liveIds = new Set(liveModules.map((m) => m.id));

    const closesLoop = notSetup.find((m) => SYNERGY_NEIGHBORS[m.id]?.some((n) => liveIds.has(n)));

    if (closesLoop) {
      const liveNeighbor = liveModules.find((lm) =>
        SYNERGY_NEIGHBORS[closesLoop.id]?.includes(lm.id),
      );
      const key = `${liveNeighbor?.id}+${closesLoop.id}`;
      return {
        moduleId: closesLoop.id,
        type: "enable",
        message: ENABLE_MESSAGES[key] ?? `Activate ${closesLoop.label}`,
        href: closesLoop.cta.href,
      };
    }

    const ltb = notSetup.find((m) => m.id === "lead-to-booking");
    const target = ltb ?? notSetup[0];
    return {
      moduleId: target.id,
      type: "enable",
      message: ENABLE_MESSAGES.default,
      href: target.cta.href,
    };
  }

  return {
    moduleId: null,
    type: "all_live",
    message: "Revenue loop active — all modules operational",
    href: "/dashboard/roi",
  };
}
