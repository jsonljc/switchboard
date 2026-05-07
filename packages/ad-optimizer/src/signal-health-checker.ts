// packages/ad-optimizer/src/signal-health-checker.ts
//
// Pulls Meta pixel + CAPI health metrics and scores them against the
// "Optimal CAPI Setup" thresholds (server-to-browser >90%, dedup >50%,
// freshness <1h). EMQ composite isn't on public MAPI, so we substitute
// (server_to_browser_ratio × dedup_rate) as a proxy.

const API_BASE = "https://graph.facebook.com/v21.0";

const PIXEL_FIELDS = ["name", "last_fired_time", "is_unavailable", "automatic_matching_fields"];

const PIXEL_DEAD_AGE_MS = 24 * 60 * 60_000;
const FRESHNESS_THRESHOLD_MS = 60 * 60_000;
const RATIO_GREEN = 0.9;
const RATIO_RED = 0.5;
const DEDUP_GREEN = 0.5;

interface SignalHealthCheckerConfig {
  accessToken: string;
}

export interface PixelHealth {
  pixelId: string;
  name: string;
  lastFiredAt: string | null;
  isUnavailable: boolean;
  automaticMatchingFields: string[];
  isDead: boolean;
}

export interface EventVolumeEntry {
  eventName: string;
  totalCount: number;
  serverCount: number;
  browserCount: number;
}

export interface EventVolume {
  events: EventVolumeEntry[];
}

export interface CAPIHealth {
  serverToBrowserRatio: number;
  dedupRate: number;
  lastServerEventAt: string | null;
  freshnessMs: number;
  isFresh: boolean;
}

export interface DaCheck {
  eventName: string;
  passed: boolean;
  description: string;
  connectionMethod: string;
}

export interface DaChecks {
  checks: DaCheck[];
  hasFailure: boolean;
}

export type SignalHealthScore = "red" | "yellow" | "green";

export type BreachSignal =
  | "pixel_dead"
  | "server_to_browser_low"
  | "dedup_low"
  | "freshness_stale"
  | "da_check_failed";

export interface Breach {
  signal: BreachSignal;
  severity: "critical" | "warning";
  message: string;
}

export interface SignalHealthReport {
  pixelId: string;
  score: SignalHealthScore;
  pixelHealth: PixelHealth;
  eventVolume: EventVolume;
  capiHealth: CAPIHealth;
  daChecks: DaChecks;
  emqProxy: number;
  breaches: Breach[];
}

/**
 * Slim interface consumed by AuditRunner and the inngest cron — keeps
 * call sites decoupled from the concrete SignalHealthChecker class so
 * tests and alt implementations (e.g. cached/mock providers) can plug in
 * without inheritance gymnastics.
 */
export interface SignalHealthReportProvider {
  getSignalHealthReport(pixelId: string): Promise<SignalHealthReport>;
}

interface PixelMetadataResponse {
  id: string;
  name: string;
  last_fired_time: string | null;
  is_unavailable: boolean;
  automatic_matching_fields: string[];
}

interface StatsRow {
  event: string;
  value: number;
  matched_count?: number;
  last_event_time?: string;
}

interface StatsResponse {
  data: StatsRow[];
}

interface DaChecksRow {
  key: string;
  event_name: string;
  description: string;
  connection_method: string;
  result: "PASS" | "FAIL";
}

interface DaChecksResponse {
  data: DaChecksRow[];
}

interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
  };
}

export class SignalHealthChecker {
  private readonly accessToken: string;

  constructor(config: SignalHealthCheckerConfig) {
    this.accessToken = config.accessToken;
  }

  async getPixelHealth(pixelId: string): Promise<PixelHealth> {
    const params = new URLSearchParams({ fields: PIXEL_FIELDS.join(",") });
    const raw = (await this.get(
      `/${pixelId}?${params.toString()}`,
    )) as unknown as PixelMetadataResponse;
    const lastFiredAt = raw.last_fired_time ?? null;
    const isUnavailable = Boolean(raw.is_unavailable);
    const isDead = computeIsDead(lastFiredAt, isUnavailable, Date.now());
    return {
      pixelId,
      name: raw.name ?? "",
      lastFiredAt,
      isUnavailable,
      automaticMatchingFields: raw.automatic_matching_fields ?? [],
      isDead,
    };
  }

  async getEventVolume(pixelId: string): Promise<EventVolume> {
    const [combined, serverOnly] = await Promise.all([
      this.get(`/${pixelId}/stats`) as unknown as Promise<StatsResponse>,
      this.get(
        `/${pixelId}/stats?event_sources=${encodeURIComponent('["server"]')}`,
      ) as unknown as Promise<StatsResponse>,
    ]);

    const serverByEvent = new Map<string, number>();
    for (const row of serverOnly.data ?? []) {
      serverByEvent.set(row.event, (serverByEvent.get(row.event) ?? 0) + row.value);
    }

    const combinedByEvent = new Map<string, number>();
    for (const row of combined.data ?? []) {
      combinedByEvent.set(row.event, (combinedByEvent.get(row.event) ?? 0) + row.value);
    }

    const eventNames = new Set<string>([...combinedByEvent.keys(), ...serverByEvent.keys()]);
    const events: EventVolumeEntry[] = [];
    for (const name of eventNames) {
      const totalCount = combinedByEvent.get(name) ?? 0;
      const serverCount = serverByEvent.get(name) ?? 0;
      const browserCount = Math.max(0, totalCount - serverCount);
      events.push({ eventName: name, totalCount, serverCount, browserCount });
    }
    return { events };
  }

  async getCAPIHealth(pixelId: string): Promise<CAPIHealth> {
    const [combined, serverOnly] = await Promise.all([
      this.get(`/${pixelId}/stats`) as unknown as Promise<StatsResponse>,
      this.get(
        `/${pixelId}/stats?event_sources=${encodeURIComponent('["server"]')}`,
      ) as unknown as Promise<StatsResponse>,
    ]);

    let totalAll = 0;
    for (const row of combined.data ?? []) totalAll += row.value;

    let totalServer = 0;
    let matchedServer = 0;
    let latestServerTimestampMs: number | null = null;
    let latestServerIso: string | null = null;
    for (const row of serverOnly.data ?? []) {
      totalServer += row.value;
      matchedServer += row.matched_count ?? 0;
      if (row.last_event_time) {
        const ts = Date.parse(row.last_event_time);
        if (
          !Number.isNaN(ts) &&
          (latestServerTimestampMs === null || ts > latestServerTimestampMs)
        ) {
          latestServerTimestampMs = ts;
          latestServerIso = row.last_event_time;
        }
      }
    }

    const serverToBrowserRatio = totalAll === 0 ? 0 : Math.min(1, totalServer / totalAll);
    const dedupRate = totalServer === 0 ? 0 : matchedServer / totalServer;
    const now = Date.now();
    const freshnessMs = latestServerTimestampMs === null ? Infinity : now - latestServerTimestampMs;
    const isFresh = latestServerTimestampMs !== null && freshnessMs < FRESHNESS_THRESHOLD_MS;

    return {
      serverToBrowserRatio,
      dedupRate,
      lastServerEventAt: latestServerIso,
      freshnessMs: latestServerTimestampMs === null ? 0 : freshnessMs,
      isFresh,
    };
  }

  async getDaChecks(pixelId: string): Promise<DaChecks> {
    const raw = (await this.get(`/${pixelId}/da_checks`)) as unknown as DaChecksResponse;
    const checks: DaCheck[] = (raw.data ?? []).map((row) => ({
      eventName: row.event_name ?? "",
      passed: row.result === "PASS",
      description: row.description ?? "",
      connectionMethod: row.connection_method ?? "",
    }));
    return {
      checks,
      hasFailure: checks.some((c) => !c.passed),
    };
  }

  async getSignalHealthReport(pixelId: string): Promise<SignalHealthReport> {
    const pixelHealth = await this.getPixelHealth(pixelId);
    const eventVolume = await this.getEventVolume(pixelId);
    const capiHealth = await this.getCAPIHealth(pixelId);
    const daChecks = await this.getDaChecks(pixelId);

    const breaches = computeBreaches(pixelHealth, capiHealth, daChecks);
    const score = scoreFromBreaches(breaches);
    const emqProxy = capiHealth.serverToBrowserRatio * capiHealth.dedupRate;

    return {
      pixelId,
      score,
      pixelHealth,
      eventVolume,
      capiHealth,
      daChecks,
      emqProxy,
      breaches,
    };
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) {
      let message = "Unknown error";
      try {
        const errorBody = (await response.json()) as MetaApiError;
        if (errorBody.error?.message) {
          message = errorBody.error.message;
        }
      } catch {
        // JSON parse failed; default message.
      }
      throw new Error(`Meta API error (${response.status}): ${message}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

function computeIsDead(lastFiredAt: string | null, isUnavailable: boolean, nowMs: number): boolean {
  if (isUnavailable) return true;
  if (!lastFiredAt) return true;
  const ts = Date.parse(lastFiredAt);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts > PIXEL_DEAD_AGE_MS;
}

function computeBreaches(
  pixelHealth: PixelHealth,
  capiHealth: CAPIHealth,
  daChecks: DaChecks,
): Breach[] {
  const breaches: Breach[] = [];

  if (pixelHealth.isDead) {
    breaches.push({
      signal: "pixel_dead",
      severity: "critical",
      message: pixelHealth.isUnavailable
        ? "Pixel is marked unavailable in Meta — check website installation."
        : "Pixel has not fired in over 24 hours — check website installation.",
    });
  }

  if (capiHealth.serverToBrowserRatio < RATIO_RED) {
    breaches.push({
      signal: "server_to_browser_low",
      severity: "critical",
      message:
        "Server-to-browser ratio is critically low (<50%). " +
        "CAPI is sending almost no events — verify access token and pixel ID.",
    });
  } else if (capiHealth.serverToBrowserRatio < RATIO_GREEN) {
    breaches.push({
      signal: "server_to_browser_low",
      severity: "warning",
      message:
        `Server-to-browser ratio is ${(capiHealth.serverToBrowserRatio * 100).toFixed(0)}% ` +
        "(target >90%). Verify CAPI access token and pixel ID.",
    });
  }

  if (capiHealth.dedupRate < DEDUP_GREEN && capiHealth.serverToBrowserRatio >= RATIO_RED) {
    breaches.push({
      signal: "dedup_low",
      severity: "warning",
      message:
        `Dedup rate is ${(capiHealth.dedupRate * 100).toFixed(0)}% (target >50%). ` +
        "Ensure event_id matches between browser pixel and CAPI.",
    });
  }

  if (
    !capiHealth.isFresh &&
    capiHealth.lastServerEventAt !== null &&
    capiHealth.serverToBrowserRatio >= RATIO_RED
  ) {
    breaches.push({
      signal: "freshness_stale",
      severity: "warning",
      message: "Last CAPI server event is over 1 hour old — check dispatch latency.",
    });
  }

  if (daChecks.hasFailure) {
    const failed = daChecks.checks.filter((c) => !c.passed).map((c) => c.eventName);
    breaches.push({
      signal: "da_check_failed",
      severity: "warning",
      message: `Insufficient signal for: ${failed.join(", ")}.`,
    });
  }

  return breaches;
}

function scoreFromBreaches(breaches: Breach[]): SignalHealthScore {
  if (breaches.some((b) => b.severity === "critical")) return "red";
  if (breaches.length > 0) return "yellow";
  return "green";
}
