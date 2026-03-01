// ---------------------------------------------------------------------------
// Integration tests for DigitalAdsCartridge
// ---------------------------------------------------------------------------
// Covers: bootstrap factory, enrichContext validation, captureSnapshot,
// getRiskInput, guardrails, healthCheck edge cases, and
// cross-platform flows.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { DigitalAdsCartridge } from "../index.js";
import { bootstrapDigitalAdsCartridge } from "../bootstrap.js";
import { DEFAULT_DIGITAL_ADS_POLICIES } from "../defaults/policies.js";
import { MockProvider } from "../providers/mock-provider.js";
import { DEFAULT_DIGITAL_ADS_GUARDRAILS } from "../defaults/guardrails.js";
import type { DiagnosticResult } from "../../core/types.js";
import type { CartridgeContext } from "../types.js";

const defaultCtx: CartridgeContext = {
  principalId: "user_1",
  organizationId: null,
  connectionCredentials: {},
};

// ---------------------------------------------------------------------------
// Bootstrap factory
// ---------------------------------------------------------------------------

describe("bootstrapDigitalAdsCartridge", () => {
  it("creates cartridge with mock providers", async () => {
    const { cartridge } = await bootstrapDigitalAdsCartridge({
      accessToken: "test-token",
      adAccountId: "act_test",
      useMocks: true,
    });
    expect(cartridge).toBeDefined();
    expect(cartridge.manifest.id).toBe("digital-ads");

    // Should be able to connect to all platforms
    const result = await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "meta", accessToken: "test" },
        entityId: "act_123",
      },
      defaultCtx
    );
    expect(result.success).toBe(true);
  });

  it("creates cartridge with real providers by default", async () => {
    const { cartridge } = await bootstrapDigitalAdsCartridge({
      accessToken: "test",
      adAccountId: "act_test",
    });
    expect(cartridge).toBeDefined();
    expect(cartridge.manifest.id).toBe("digital-ads");
    expect(cartridge.manifest.name).toBe("Digital Ads");
  });

  it("returns interceptors array", async () => {
    const { interceptors } = await bootstrapDigitalAdsCartridge({
      accessToken: "test-token",
      adAccountId: "act_test",
      useMocks: true,
    });
    expect(Array.isArray(interceptors)).toBe(true);
    expect(interceptors.length).toBeGreaterThan(0);
  });

  it("exports default policies for seeding", () => {
    expect(Array.isArray(DEFAULT_DIGITAL_ADS_POLICIES)).toBe(true);
    expect(DEFAULT_DIGITAL_ADS_POLICIES.length).toBeGreaterThan(0);
    expect(DEFAULT_DIGITAL_ADS_POLICIES[0]).toHaveProperty("id");
    expect(DEFAULT_DIGITAL_ADS_POLICIES[0]).toHaveProperty("effect");
    expect(DEFAULT_DIGITAL_ADS_POLICIES[0]).toHaveProperty("rule");
  });

  it("returns correct bootstrap shape", async () => {
    const result = await bootstrapDigitalAdsCartridge({
      accessToken: "test-token",
      adAccountId: "act_test",
      useMocks: true,
    });
    expect(result).toHaveProperty("cartridge");
    expect(result).toHaveProperty("interceptors");
  });

  it("auto-connects credentials from initialization context", async () => {
    const { cartridge } = await bootstrapDigitalAdsCartridge({
      accessToken: "pre_configured",
      adAccountId: "act_test",
      useMocks: true,
    });

    // The bootstrap initializes with the provided accessToken as meta credentials
    const internal = cartridge as DigitalAdsCartridge;
    const session = internal.getSession();
    const conn = session.connections.get("meta");
    expect(conn).toBeDefined();
    expect(conn!.status).toBe("connected");
  });

  it("passes custom mock snapshots to providers", async () => {
    const { cartridge } = await bootstrapDigitalAdsCartridge({
      accessToken: "test-token",
      adAccountId: "act_test",
      useMocks: true,
      mockSnapshots: {
        meta: { spend: 5000 },
      },
    });

    // Connect and run diagnostic to verify snapshot data flows through
    const result = await cartridge.execute(
      "digital-ads.funnel.diagnose",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
      },
      {
        principalId: "user_1",
        organizationId: null,
        connectionCredentials: {
          meta: { platform: "meta", accessToken: "test" },
        },
      }
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enrichContext validation
// ---------------------------------------------------------------------------

describe("enrichContext", () => {
  async function createCartridge() {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    cartridge.registerProvider(new MockProvider("google"));
    cartridge.registerProvider(new MockProvider("tiktok"));
    await cartridge.initialize(defaultCtx);
    return cartridge;
  }

  it("returns Record<string, unknown> with enrichment data", async () => {
    const cartridge = await createCartridge();
    const enriched = await cartridge.enrichContext(
      "digital-ads.funnel.diagnose",
      { platform: "meta", vertical: "commerce" },
      defaultCtx
    );

    expect(enriched.resolvedFunnel).toBeDefined();
    expect(enriched.resolvedBenchmarks).toBeDefined();
  });

  it("resolves platform configs for portfolio.diagnose", async () => {
    const cartridge = await createCartridge();
    const enriched = await cartridge.enrichContext(
      "digital-ads.portfolio.diagnose",
      {
        vertical: "commerce",
        platforms: [
          { platform: "meta", entityId: "act_1" },
          { platform: "google", entityId: "g_1" },
        ],
      },
      defaultCtx
    );

    const resolved = enriched.resolvedPlatforms as Array<{ platform: string }>;
    expect(resolved).toBeDefined();
    expect(resolved.length).toBe(2);
    expect(resolved[0].platform).toBe("meta");
    expect(resolved[1].platform).toBe("google");
  });

  it("sets validationError when timeRange.since is after timeRange.until", async () => {
    const cartridge = await createCartridge();
    const enriched = await cartridge.enrichContext(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
        timeRange: { since: "2024-01-14", until: "2024-01-08" },
      },
      defaultCtx
    );

    expect(enriched.validationError).toBeDefined();
    expect(enriched.validationError).toContain("before");
  });

  it("sets validationError when timeRange is missing since or until", async () => {
    const cartridge = await createCartridge();
    const enriched = await cartridge.enrichContext(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
        timeRange: { since: "2024-01-08" },
      },
      defaultCtx
    );

    expect(enriched.validationError).toBeDefined();
  });

  it("sets validationError when credential platform mismatches", async () => {
    const cartridge = await createCartridge();
    const enriched = await cartridge.enrichContext(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "google", clientId: "c", clientSecret: "s", refreshToken: "r", developerToken: "d" },
        entityId: "act_123",
      },
      defaultCtx
    );

    expect(enriched.validationError).toBeDefined();
    expect(enriched.validationError).toContain("doesn't match");
  });

  it("execute rejects when context has validationError", async () => {
    const cartridge = await createCartridge();

    // Pre-connect
    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "meta", accessToken: "test" },
        entityId: "act_123",
      },
      defaultCtx
    );

    // Execute with validationError already in context (orchestrator would set this)
    const result = await cartridge.execute(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
        timeRange: { since: "2024-01-08", until: "2024-01-14" },
      },
      {
        ...defaultCtx,
        validationError: "timeRange.since must be before timeRange.until",
      }
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Validation failed");
    expect(result.partialFailures[0].step).toBe("validation");
  });
});

// ---------------------------------------------------------------------------
// captureSnapshot
// ---------------------------------------------------------------------------

describe("captureSnapshot", () => {
  it("returns empty object for read-only actions without write provider", async () => {
    const cartridge = new DigitalAdsCartridge();
    await cartridge.initialize(defaultCtx);

    const snapshot = await cartridge.captureSnapshot(
      "digital-ads.funnel.diagnose",
      { entityId: "act_123" },
      defaultCtx
    );

    // Read-only actions return empty snapshot
    expect(snapshot).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getRiskInput
// ---------------------------------------------------------------------------

describe("getRiskInput", () => {
  const cartridge = new DigitalAdsCartridge();

  it("returns none risk for platform.connect", async () => {
    const risk = await cartridge.getRiskInput(
      "digital-ads.platform.connect",
      { platform: "meta" },
      defaultCtx
    );
    expect(risk.baseRisk).toBe("none");
    expect(risk.exposure.dollarsAtRisk).toBe(0);
    expect(risk.reversibility).toBe("full");
  });

  it("returns low risk for funnel.diagnose", async () => {
    const risk = await cartridge.getRiskInput(
      "digital-ads.funnel.diagnose",
      { platform: "meta", entityId: "act_123" },
      defaultCtx
    );
    expect(risk.baseRisk).toBe("low");
    expect(risk.exposure.blastRadius).toBe(1);
  });

  it("returns none risk for health.check", async () => {
    const risk = await cartridge.getRiskInput(
      "digital-ads.health.check",
      {},
      defaultCtx
    );
    expect(risk.baseRisk).toBe("none");
  });

  it("returns platformCount blast radius for portfolio", async () => {
    const risk = await cartridge.getRiskInput(
      "digital-ads.portfolio.diagnose",
      {
        platforms: [
          { platform: "meta" },
          { platform: "google" },
          { platform: "tiktok" },
        ],
      },
      defaultCtx
    );
    expect(risk.exposure.blastRadius).toBe(3);
  });

  it("returns 2 for 2 platform portfolio", async () => {
    const risk = await cartridge.getRiskInput(
      "digital-ads.portfolio.diagnose",
      {
        platforms: [{ platform: "meta" }, { platform: "google" }],
      },
      defaultCtx
    );
    expect(risk.exposure.blastRadius).toBe(2);
  });

  it("all actions have 0 dollarsAtRisk (read-only)", async () => {
    const actions = [
      "digital-ads.platform.connect",
      "digital-ads.funnel.diagnose",
      "digital-ads.portfolio.diagnose",
      "digital-ads.snapshot.fetch",
      "digital-ads.structure.analyze",
      "digital-ads.health.check",
    ] as const;

    for (const action of actions) {
      const risk = await cartridge.getRiskInput(action, {}, defaultCtx);
      expect(risk.exposure.dollarsAtRisk).toBe(0);
      expect(risk.sensitivity.entityVolatile).toBe(false);
      expect(risk.sensitivity.learningPhase).toBe(false);
    }
  });

  it("blastRadius is a number", async () => {
    const risk = await cartridge.getRiskInput(
      "digital-ads.funnel.diagnose",
      { platform: "meta", entityId: "act_123" },
      defaultCtx
    );
    expect(typeof risk.exposure.blastRadius).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// getGuardrails
// ---------------------------------------------------------------------------

describe("getGuardrails", () => {
  it("returns default guardrails configuration", () => {
    const cartridge = new DigitalAdsCartridge();
    const guardrails = cartridge.getGuardrails();

    expect(guardrails).toEqual(DEFAULT_DIGITAL_ADS_GUARDRAILS);
    expect(Array.isArray(guardrails.rateLimits)).toBe(true);
    expect(guardrails.rateLimits.length).toBeGreaterThan(0);
    expect(guardrails.rateLimits[0]).toHaveProperty("maxActions");
    expect(guardrails.rateLimits[0]).toHaveProperty("windowMs");
    expect(guardrails.rateLimits[0]).toHaveProperty("scope");
    expect(guardrails.cooldowns.length).toBeGreaterThanOrEqual(2);
    expect(guardrails.cooldowns[0]).toHaveProperty("cooldownMs");
    expect(guardrails.cooldowns[0]).toHaveProperty("scope");
    expect(Array.isArray(guardrails.protectedEntities)).toBe(true);
    expect(guardrails.protectedEntities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// healthCheck (cartridge-level)
// ---------------------------------------------------------------------------

describe("cartridge.healthCheck()", () => {
  it("returns disconnected ConnectionHealth when no platforms are connected", async () => {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    await cartridge.initialize(defaultCtx);

    const health = await cartridge.healthCheck();
    expect(health.status).toBe("disconnected");
    expect(health.latencyMs).toBe(0);
    expect(health.error).toBeNull();
    expect(health.capabilities).toHaveLength(0);
  });

  it("returns connected status for connected platforms", async () => {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    cartridge.registerProvider(new MockProvider("google"));
    await cartridge.initialize(defaultCtx);

    // Connect meta
    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "meta", accessToken: "test" },
        entityId: "act_123",
      },
      defaultCtx
    );

    const health = await cartridge.healthCheck();
    expect(health.status).toBeDefined();
    expect(["connected", "degraded"].includes(health.status)).toBe(true);
    expect(typeof health.latencyMs).toBe("number");
    expect(health.capabilities).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Google and TikTok platform flows
// ---------------------------------------------------------------------------

describe("cross-platform flows", () => {
  async function createCartridge() {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    cartridge.registerProvider(new MockProvider("google"));
    cartridge.registerProvider(new MockProvider("tiktok"));
    await cartridge.initialize(defaultCtx);
    return cartridge;
  }

  it("runs funnel diagnostic on Google platform", async () => {
    const cartridge = await createCartridge();

    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "google",
        credentials: {
          platform: "google",
          clientId: "c",
          clientSecret: "s",
          refreshToken: "r",
          developerToken: "d",
        },
        entityId: "google_123",
      },
      defaultCtx
    );

    const result = await cartridge.execute(
      "digital-ads.funnel.diagnose",
      {
        platform: "google",
        entityId: "google_123",
        vertical: "commerce",
      },
      defaultCtx
    );

    expect(result.success).toBe(true);
    const diag = result.data as DiagnosticResult;
    expect(diag.platform).toBe("google");
  });

  it("runs funnel diagnostic on TikTok platform", async () => {
    const cartridge = await createCartridge();

    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "tiktok",
        credentials: {
          platform: "tiktok",
          accessToken: "tok",
          appId: "app",
        },
        entityId: "tt_123",
      },
      defaultCtx
    );

    const result = await cartridge.execute(
      "digital-ads.funnel.diagnose",
      {
        platform: "tiktok",
        entityId: "tt_123",
        vertical: "commerce",
      },
      defaultCtx
    );

    expect(result.success).toBe(true);
    const diag = result.data as DiagnosticResult;
    expect(diag.platform).toBe("tiktok");
  });

  it("runs 3-platform portfolio diagnostic", async () => {
    const cartridge = await createCartridge();

    const result = await cartridge.execute(
      "digital-ads.portfolio.diagnose",
      {
        name: "Full Portfolio",
        vertical: "commerce",
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_meta",
          },
          {
            platform: "google",
            credentials: {
              platform: "google",
              clientId: "c",
              clientSecret: "s",
              refreshToken: "r",
              developerToken: "d",
            },
            entityId: "google_1",
          },
          {
            platform: "tiktok",
            credentials: {
              platform: "tiktok",
              accessToken: "tok",
              appId: "app",
            },
            entityId: "tt_1",
          },
        ],
      },
      defaultCtx
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("3 platforms succeeded");
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe("initialize", () => {
  it("resets session state on re-initialization", async () => {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));

    // First init + connect
    await cartridge.initialize(defaultCtx);
    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "meta", accessToken: "test" },
        entityId: "act_123",
      },
      defaultCtx
    );
    expect(cartridge.getSession().connections.size).toBe(1);

    // Re-initialize — session should be reset
    await cartridge.initialize(defaultCtx);
    expect(cartridge.getSession().connections.size).toBe(0);
  });

  it("skips invalid platform types from context credentials", async () => {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    await cartridge.initialize({
      principalId: "user_1",
      organizationId: null,
      connectionCredentials: {
        invalid_platform: { platform: "meta", accessToken: "test" },
        meta: { platform: "meta", accessToken: "test" },
      },
    });

    const session = cartridge.getSession();
    // Only meta should be connected, not "invalid_platform"
    expect(session.connections.has("meta")).toBe(true);
    expect(session.connections.size).toBe(1);
  });
});
