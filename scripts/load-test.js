// =============================================================================
// Switchboard Load Test — 100 concurrent users
// Requires: npm install -g k6  (https://k6.io)
// Usage:    k6 run scripts/load-test.js
// Override: k6 run --env BASE_URL=https://api.example.com scripts/load-test.js
// =============================================================================

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Custom metrics ──
const errorRate = new Rate("errors");
const apiLatency = new Trend("api_latency", true);
const healthLatency = new Trend("health_latency", true);
const dashboardLatency = new Trend("dashboard_latency", true);
const requestCount = new Counter("total_requests");

// ── Configuration ──
const BASE = __ENV.BASE_URL || "http://localhost:3000";
const DASHBOARD = __ENV.DASHBOARD_URL || "http://localhost:3002";
const API_KEY = __ENV.API_KEY || "";

const headers = {
  "Content-Type": "application/json",
};
if (API_KEY) {
  headers["Authorization"] = `Bearer ${API_KEY}`;
}

// ── Scenarios ──
export const options = {
  scenarios: {
    // Ramp up to 100 virtual users over 2 minutes, sustain for 3 minutes,
    // then ramp down over 1 minute.
    load_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 25 },   // Warm up
        { duration: "30s", target: 50 },   // Half load
        { duration: "1m", target: 100 },   // Full load
        { duration: "2m", target: 100 },   // Sustain
        { duration: "30s", target: 0 },    // Cool down
      ],
    },

    // Spike test: sudden burst of 100 users
    spike_test: {
      executor: "ramping-vus",
      startVUs: 0,
      startTime: "5m",  // Start after load test
      stages: [
        { duration: "10s", target: 100 },  // Instant spike
        { duration: "1m", target: 100 },   // Sustain spike
        { duration: "10s", target: 0 },    // Drop
      ],
    },
  },

  thresholds: {
    http_req_duration: ["p(95)<2000"],      // 95% of requests under 2s
    http_req_failed: ["rate<0.05"],         // Less than 5% errors
    errors: ["rate<0.05"],                  // Custom error rate under 5%
    health_latency: ["p(95)<500"],          // Health checks fast
    api_latency: ["p(95)<3000"],            // API calls under 3s
  },
};

// ── Helper ──
function apiGet(path, latencyMetric) {
  const res = http.get(`${BASE}${path}`, { headers, timeout: "10s" });
  requestCount.add(1);
  const ok = res.status >= 200 && res.status < 500; // 4xx = expected, 5xx = error
  errorRate.add(res.status >= 500);
  if (latencyMetric) latencyMetric.add(res.timings.duration);
  return { res, ok };
}

function apiPost(path, body, latencyMetric) {
  const res = http.post(`${BASE}${path}`, JSON.stringify(body), {
    headers,
    timeout: "10s",
  });
  requestCount.add(1);
  errorRate.add(res.status >= 500);
  if (latencyMetric) latencyMetric.add(res.timings.duration);
  return { res, ok: res.status >= 200 && res.status < 500 };
}

// ── Virtual User Journey ──
// Each VU simulates a realistic user session:
// 1. Check health
// 2. Load dashboard
// 3. Browse API endpoints
// 4. Interact with CRM/pipeline
// 5. Check governance

export default function () {
  // ── 1. Health check (every user starts here) ──
  group("Health", () => {
    const { res } = apiGet("/health", healthLatency);
    check(res, {
      "health returns 200": (r) => r.status === 200,
      "health has ok status": (r) => {
        try {
          return JSON.parse(r.body).status === "ok";
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.5);

  // ── 2. Dashboard load ──
  group("Dashboard", () => {
    const res = http.get(DASHBOARD, { timeout: "10s" });
    requestCount.add(1);
    dashboardLatency.add(res.timings.duration);
    check(res, {
      "dashboard loads": (r) => r.status === 200,
    });
  });

  sleep(0.3);

  // ── 3. Core API browsing (typical operator workflow) ──
  group("API Browse", () => {
    const endpoints = [
      "/api/organizations",
      "/api/cartridges",
      "/api/agents",
      "/api/token-usage",
      "/api/token-usage/models",
    ];

    for (const ep of endpoints) {
      const { res } = apiGet(ep, apiLatency);
      check(res, {
        [`${ep} responds`]: (r) => r.status >= 200 && r.status < 500,
      });
      sleep(0.1);
    }
  });

  sleep(0.5);

  // ── 4. CRM & Pipeline (most common dashboard views) ──
  group("CRM Pipeline", () => {
    const { res: contacts } = apiGet("/api/crm/contacts", apiLatency);
    check(contacts, {
      "contacts endpoint responds": (r) => r.status >= 200 && r.status < 500,
    });

    const { res: pipeline } = apiGet("/api/lifecycle/pipeline", apiLatency);
    check(pipeline, {
      "pipeline endpoint responds": (r) => r.status >= 200 && r.status < 500,
    });

    const { res: conversations } = apiGet("/api/conversations", apiLatency);
    check(conversations, {
      "conversations endpoint responds": (r) =>
        r.status >= 200 && r.status < 500,
    });
  });

  sleep(0.5);

  // ── 5. Governance & Audit ──
  group("Governance", () => {
    const { res: audit } = apiGet("/api/audit", apiLatency);
    check(audit, {
      "audit responds": (r) => r.status >= 200 && r.status < 500,
    });

    const { res: approvals } = apiGet("/api/approvals", apiLatency);
    check(approvals, {
      "approvals responds": (r) => r.status >= 200 && r.status < 500,
    });

    const { res: governance } = apiGet("/api/governance", apiLatency);
    check(governance, {
      "governance responds": (r) => r.status >= 200 && r.status < 500,
    });
  });

  sleep(0.5);

  // ── 6. Metrics endpoint (Prometheus scrape simulation) ──
  group("Metrics", () => {
    const { res } = apiGet("/metrics", apiLatency);
    check(res, {
      "metrics responds": (r) => r.status === 200,
    });
  });

  sleep(0.5);

  // ── 7. Simulate inbound message (POST — exercises the write path) ──
  group("Inbound Message", () => {
    const { res } = apiPost(
      "/api/conversation/message",
      {
        channel: "test",
        senderId: `load-test-user-${__VU}`,
        message: "Hello, I'd like to book an appointment",
        metadata: { source: "load-test" },
      },
      apiLatency,
    );
    check(res, {
      "message endpoint responds (not 500)": (r) => r.status < 500,
    });
  });

  // Random think time 1-3 seconds between iterations
  sleep(Math.random() * 2 + 1);
}

// ── Summary ──
export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] ?? 0;
  const errRate = data.metrics.errors?.values?.rate ?? 0;
  const totalReqs = data.metrics.total_requests?.values?.count ?? 0;

  console.log("\n=== SWITCHBOARD LOAD TEST SUMMARY ===");
  console.log(`Total requests:    ${totalReqs}`);
  console.log(`P95 latency:       ${p95.toFixed(0)}ms`);
  console.log(`Error rate:        ${(errRate * 100).toFixed(2)}%`);
  console.log(`Max VUs:           100`);
  console.log("");

  if (p95 > 2000) {
    console.log("WARNING: P95 latency exceeds 2s threshold");
  }
  if (errRate > 0.05) {
    console.log("WARNING: Error rate exceeds 5% threshold");
  }

  return {
    stdout: JSON.stringify(
      {
        totalRequests: totalReqs,
        p95Latency: `${p95.toFixed(0)}ms`,
        errorRate: `${(errRate * 100).toFixed(2)}%`,
        passed:
          Object.values(data.metrics)
            .filter((m) => m.thresholds)
            .every((m) =>
              Object.values(m.thresholds).every((t) => t.ok),
            ),
      },
      null,
      2,
    ),
  };
}
