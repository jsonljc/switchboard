import { describe, it, expect, beforeEach } from "vitest";
import {
  computeVariant,
  buildSegments,
  projectGreeting,
  InMemoryGreetingSignalStore,
  type GreetingSignal,
  type TopItemMeta,
  type GreetingAgentConfig,
} from "../greeting.js";

describe("computeVariant", () => {
  const alexConfig: GreetingAgentConfig = {
    agentKey: "alex",
    busyThreshold: 5,
    busyAgeHoursThreshold: 24,
    countNoun: "leads",
    countNounSingular: "lead",
  };

  const rileyConfig: GreetingAgentConfig = {
    agentKey: "riley",
    busyThreshold: 4,
    busyAgeHoursThreshold: 12,
    countNoun: "ad sets",
    countNounSingular: "ad set",
  };

  it("returns 'welcome' when inbox is empty and no prior operator action", () => {
    const signal: GreetingSignal = {
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: null,
    };
    expect(computeVariant(signal, alexConfig)).toBe("welcome");
  });

  it("returns 'quiet' when inbox is empty but operator has acted before", () => {
    const signal: GreetingSignal = {
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: 12,
    };
    expect(computeVariant(signal, alexConfig)).toBe("quiet");
  });

  it("returns 'busy' when inboxCount >= busyThreshold", () => {
    const signal: GreetingSignal = {
      inboxCount: 5,
      oldestOpenItemAgeHours: 2,
      hoursSinceLastOperatorAction: 1,
    };
    expect(computeVariant(signal, alexConfig)).toBe("busy");
  });

  it("returns 'busy' when oldestOpenItemAgeHours >= busyAgeHoursThreshold", () => {
    const signal: GreetingSignal = {
      inboxCount: 2,
      oldestOpenItemAgeHours: 24,
      hoursSinceLastOperatorAction: 1,
    };
    expect(computeVariant(signal, alexConfig)).toBe("busy");
  });

  it("returns 'named-lead' for non-empty inbox below busy thresholds", () => {
    const signal: GreetingSignal = {
      inboxCount: 3,
      oldestOpenItemAgeHours: 4,
      hoursSinceLastOperatorAction: 1,
    };
    expect(computeVariant(signal, alexConfig)).toBe("named-lead");
  });

  it("respects Riley's lower busy thresholds", () => {
    const signal: GreetingSignal = {
      inboxCount: 4,
      oldestOpenItemAgeHours: 2,
      hoursSinceLastOperatorAction: 1,
    };
    expect(computeVariant(signal, rileyConfig)).toBe("busy");
  });

  it("respects Riley's lower age threshold", () => {
    const signal: GreetingSignal = {
      inboxCount: 2,
      oldestOpenItemAgeHours: 12,
      hoursSinceLastOperatorAction: 1,
    };
    expect(computeVariant(signal, rileyConfig)).toBe("busy");
  });
});

describe("buildSegments", () => {
  const alexConfig: GreetingAgentConfig = {
    agentKey: "alex",
    busyThreshold: 5,
    busyAgeHoursThreshold: 24,
    countNoun: "leads",
    countNounSingular: "lead",
  };

  const rileyConfig: GreetingAgentConfig = {
    agentKey: "riley",
    busyThreshold: 4,
    busyAgeHoursThreshold: 12,
    countNoun: "ad sets",
    countNounSingular: "ad set",
  };

  it("builds text-only segments for 'welcome' variant", () => {
    const signal: GreetingSignal = {
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: null,
    };
    const segments = buildSegments("welcome", signal, alexConfig, null);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      kind: "text",
      text: "I'm here when you need me. I'll bring you leads worth your time.",
    });
  });

  it("builds segments for 'quiet' variant", () => {
    const signal: GreetingSignal = {
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: 12,
    };
    const segments = buildSegments("quiet", signal, alexConfig, null);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      kind: "text",
      text: "All clear for now. I'll ping you when something lands.",
    });
  });

  it("builds segments with accent for 'busy' variant", () => {
    const signal: GreetingSignal = {
      inboxCount: 6,
      oldestOpenItemAgeHours: 2,
      hoursSinceLastOperatorAction: 1,
    };
    const segments = buildSegments("busy", signal, alexConfig, null);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ kind: "text", text: "You've got " });
    expect(segments[1]).toEqual({ kind: "accent", text: "6 leads" });
  });

  it("builds segments with accent for 'named-lead' variant with topItem", () => {
    const signal: GreetingSignal = {
      inboxCount: 3,
      oldestOpenItemAgeHours: 4,
      hoursSinceLastOperatorAction: 1,
    };
    const topItem: TopItemMeta = { name: "Maya Chen", ageLabel: "3h ago" };
    const segments = buildSegments("named-lead", signal, alexConfig, topItem);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ kind: "accent", text: "Maya Chen" });
    expect(segments[1]).toEqual({ kind: "text", text: " is the one I'd answer first." });
  });

  it("falls back when 'named-lead' variant has no topItem", () => {
    const signal: GreetingSignal = {
      inboxCount: 3,
      oldestOpenItemAgeHours: 4,
      hoursSinceLastOperatorAction: 1,
    };
    const segments = buildSegments("named-lead", signal, alexConfig, null);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      kind: "text",
      text: "I've got a few leads lined up, ready when you are.",
    });
  });

  it("uses Riley's countNoun in busy variant", () => {
    const signal: GreetingSignal = {
      inboxCount: 5,
      oldestOpenItemAgeHours: 2,
      hoursSinceLastOperatorAction: 1,
    };
    const segments = buildSegments("busy", signal, rileyConfig, null);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ kind: "text", text: "You've got " });
    expect(segments[1]).toEqual({ kind: "accent", text: "5 ad sets" });
  });

  it("uses Riley's voice for named-lead variant", () => {
    const signal: GreetingSignal = {
      inboxCount: 2,
      oldestOpenItemAgeHours: 4,
      hoursSinceLastOperatorAction: 1,
    };
    const topItem: TopItemMeta = { name: "Spring Campaign", ageLabel: "2h ago" };
    const segments = buildSegments("named-lead", signal, rileyConfig, topItem);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ kind: "accent", text: "Spring Campaign" });
    expect(segments[1]).toEqual({ kind: "text", text: " needs your eye first." });
  });
});

describe("projectGreeting", () => {
  let store: InMemoryGreetingSignalStore;

  beforeEach(() => {
    store = new InMemoryGreetingSignalStore();
  });

  it("projects full greeting for Alex with named-lead variant", async () => {
    const signal: GreetingSignal = {
      inboxCount: 3,
      oldestOpenItemAgeHours: 4,
      hoursSinceLastOperatorAction: 1,
    };
    const topItem: TopItemMeta = { name: "Maya Chen", ageLabel: "3h ago" };
    store.setSignal("org1", "alex", signal);
    store.setTopItem("org1", "alex", topItem);

    const projection = await projectGreeting({ orgId: "org1", agentKey: "alex", store });

    expect(projection.variant).toBe("named-lead");
    expect(projection.segments).toHaveLength(2);
    expect(projection.segments[0]).toEqual({ kind: "accent", text: "Maya Chen" });
    expect(projection.segments[1]).toEqual({
      kind: "text",
      text: " is the one I'd answer first.",
    });
    expect(projection.signal).toEqual(signal);
    expect(projection.freshness.window).toBe("today");
    expect(projection.freshness.dataSource).toBe("live");
    expect(projection.freshness.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("projects welcome variant for empty store", async () => {
    const projection = await projectGreeting({ orgId: "org2", agentKey: "alex", store });

    expect(projection.variant).toBe("welcome");
    expect(projection.segments).toHaveLength(1);
    expect(projection.segments[0]).toEqual({
      kind: "text",
      text: "I'm here when you need me. I'll bring you leads worth your time.",
    });
    expect(projection.signal).toEqual({
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: null,
    });
  });

  it("projects busy variant for Riley", async () => {
    const signal: GreetingSignal = {
      inboxCount: 5,
      oldestOpenItemAgeHours: 2,
      hoursSinceLastOperatorAction: 1,
    };
    store.setSignal("org3", "riley", signal);

    const projection = await projectGreeting({ orgId: "org3", agentKey: "riley", store });

    expect(projection.variant).toBe("busy");
    expect(projection.segments).toHaveLength(2);
    expect(projection.segments[0]).toEqual({ kind: "text", text: "You've got " });
    expect(projection.segments[1]).toEqual({ kind: "accent", text: "5 ad sets" });
  });
});

describe("greeting — mira", () => {
  const cfg: GreetingAgentConfig = {
    agentKey: "mira",
    busyThreshold: 3,
    busyAgeHoursThreshold: 24,
    countNoun: "drafts",
    countNounSingular: "draft",
  };
  it("welcome variant copy", () => {
    const seg = buildSegments(
      "welcome",
      { inboxCount: 0, oldestOpenItemAgeHours: null, hoursSinceLastOperatorAction: null },
      cfg,
      null,
    );
    expect(seg.map((s) => s.text).join("")).toContain("draft");
  });
  it("busy variant uses drafts noun", () => {
    const seg = buildSegments(
      "busy",
      { inboxCount: 4, oldestOpenItemAgeHours: 2, hoursSinceLastOperatorAction: 1 },
      cfg,
      null,
    );
    expect(seg.map((s) => s.text).join("")).toContain("drafts");
  });
  it("named-lead points at the draft title", () => {
    const seg = buildSegments(
      "named-lead",
      { inboxCount: 1, oldestOpenItemAgeHours: 5, hoursSinceLastOperatorAction: 1 },
      cfg,
      { name: "Spring promo", ageLabel: "2d" },
    );
    expect(seg.map((s) => s.text).join("")).toContain("Spring promo");
    expect(seg.map((s) => s.text).join("")).toContain("review");
  });
});

describe("busy-count pluralization", () => {
  const miraConfig: GreetingAgentConfig = {
    agentKey: "mira",
    busyThreshold: 3,
    busyAgeHoursThreshold: 24,
    countNoun: "drafts",
    countNounSingular: "draft",
  };
  const signal: GreetingSignal = {
    inboxCount: 1,
    oldestOpenItemAgeHours: 30,
    hoursSinceLastOperatorAction: 1,
  };
  it("singularizes the busy noun at count 1", () => {
    const segs = buildSegments("busy", signal, miraConfig, null);
    expect(segs.map((s) => s.text).join("")).toBe("You've got 1 draft");
  });
  it("keeps the plural above 1", () => {
    const segs = buildSegments("busy", { ...signal, inboxCount: 3 }, miraConfig, null);
    expect(segs.map((s) => s.text).join("")).toBe("You've got 3 drafts");
  });
});

describe("voice: greeting prose carries no em-dash", () => {
  it("every variant/agent combination is em-dash free", () => {
    const configs: GreetingAgentConfig[] = [
      {
        agentKey: "alex",
        busyThreshold: 5,
        busyAgeHoursThreshold: 24,
        countNoun: "leads",
        countNounSingular: "lead",
      },
      {
        agentKey: "riley",
        busyThreshold: 4,
        busyAgeHoursThreshold: 12,
        countNoun: "ad sets",
        countNounSingular: "ad set",
      },
      {
        agentKey: "mira",
        busyThreshold: 3,
        busyAgeHoursThreshold: 24,
        countNoun: "drafts",
        countNounSingular: "draft",
      },
    ];
    const variants: Array<"welcome" | "quiet" | "busy" | "named-lead"> = [
      "welcome",
      "quiet",
      "busy",
      "named-lead",
    ];
    for (const config of configs) {
      for (const variant of variants) {
        const segs = buildSegments(
          variant,
          { inboxCount: 2, oldestOpenItemAgeHours: 1, hoursSinceLastOperatorAction: 1 },
          config,
          null,
        );
        const text = segs.map((s) => s.text).join("");
        expect(text, `${config.agentKey}/${variant}`).not.toMatch(/—/);
      }
    }
  });
});

describe("InMemoryGreetingSignalStore", () => {
  it("returns default zero signal when not seeded", async () => {
    const store = new InMemoryGreetingSignalStore();
    const signal = await store.getSignal("org1", "alex");
    expect(signal).toEqual({
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: null,
    });
  });

  it("returns seeded signal", async () => {
    const store = new InMemoryGreetingSignalStore();
    const signal: GreetingSignal = {
      inboxCount: 3,
      oldestOpenItemAgeHours: 5,
      hoursSinceLastOperatorAction: 2,
    };
    store.setSignal("org1", "alex", signal);
    const retrieved = await store.getSignal("org1", "alex");
    expect(retrieved).toEqual(signal);
  });

  it("returns null top item when not seeded", async () => {
    const store = new InMemoryGreetingSignalStore();
    const topItem = await store.getTopItem("org1", "alex");
    expect(topItem).toBeNull();
  });

  it("returns seeded top item", async () => {
    const store = new InMemoryGreetingSignalStore();
    const topItem: TopItemMeta = { name: "Maya Chen", ageLabel: "3h ago" };
    store.setTopItem("org1", "alex", topItem);
    const retrieved = await store.getTopItem("org1", "alex");
    expect(retrieved).toEqual(topItem);
  });
});
