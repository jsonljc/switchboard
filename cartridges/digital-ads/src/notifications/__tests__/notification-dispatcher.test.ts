import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationDispatcher } from "../notification-dispatcher.js";
import type {
  NotificationChannelConfig,
  NotificationPayload,
  NotificationResult,
} from "../types.js";
import type { AnomalyResult, BudgetForecast, PolicyScanResult } from "../../alerting/types.js";

// ── Mock all channel modules ──
vi.mock("../channels/webhook-channel.js", () => ({
  WebhookChannel: vi.fn(),
}));

vi.mock("../channels/slack-channel.js", () => ({
  SlackChannel: vi.fn(),
}));

vi.mock("../channels/email-channel.js", () => ({
  EmailChannel: vi.fn(),
}));

import { WebhookChannel } from "../channels/webhook-channel.js";
import { SlackChannel } from "../channels/slack-channel.js";
import { EmailChannel } from "../channels/email-channel.js";

const MockedWebhookChannel = vi.mocked(WebhookChannel);
const MockedSlackChannel = vi.mocked(SlackChannel);
const MockedEmailChannel = vi.mocked(EmailChannel);

// ── Test Data Factories ──

const makeWebhookConfig = (): NotificationChannelConfig => ({
  type: "webhook",
  url: "https://example.com/webhook",
  headers: { "X-Custom": "test" },
  method: "POST",
});

const makeSlackConfig = (): NotificationChannelConfig => ({
  type: "slack",
  webhookUrl: "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX",
  channel: "#alerts",
  username: "Switchboard",
});

const makeEmailConfig = (): NotificationChannelConfig => ({
  type: "email",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  from: "alerts@example.com",
  to: ["admin@example.com"],
  useTls: true,
});

const makePayload = (overrides?: Partial<NotificationPayload>): NotificationPayload => ({
  alertType: "anomaly",
  severity: "warning",
  accountId: "acc_123",
  title: "Test Alert",
  message: "This is a test alert",
  details: { metric: "ctr", value: 0.05 },
  timestamp: new Date("2024-01-15T10:00:00Z").toISOString(),
  ...overrides,
});

const makeAnomaly = (overrides?: Partial<AnomalyResult>): AnomalyResult => ({
  metric: "ctr",
  currentValue: 0.05,
  historicalMean: 0.02,
  historicalStdDev: 0.005,
  zScore: 6.0,
  severity: "critical",
  message: "CTR is significantly higher than historical average",
  ...overrides,
});

const makeBudgetForecast = (overrides?: Partial<BudgetForecast>): BudgetForecast => ({
  campaignId: "camp_123",
  campaignName: "Test Campaign",
  dailyBudget: 100,
  dailySpendRate: 120,
  remainingBudget: 500,
  daysUntilExhaustion: 4,
  projectedMonthlySpend: 3600,
  status: "overspending",
  recommendations: ["Consider increasing daily budget to avoid exhaustion"],
  ...overrides,
});

const makePolicyScanResult = (overrides?: Partial<PolicyScanResult>): PolicyScanResult => ({
  adAccountId: "act_123",
  scannedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
  disapprovedAds: [],
  policyWarnings: [],
  spendLimitApproaching: false,
  overallHealthy: true,
  issues: [],
  ...overrides,
});

// ── Tests ──

describe("NotificationDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("accepts channel configs", () => {
      const channels = [makeWebhookConfig(), makeSlackConfig()];

      const dispatcher = new NotificationDispatcher(channels);

      expect(dispatcher).toBeDefined();
    });

    it("accepts empty channel array", () => {
      const dispatcher = new NotificationDispatcher([]);

      expect(dispatcher).toBeDefined();
    });
  });

  describe("dispatch", () => {
    it("sends to all configured channels", async () => {
      const webhookSendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
        responseStatus: 200,
      });
      const slackSendMock = vi.fn().mockResolvedValue({
        channelType: "slack",
        success: true,
        responseStatus: 200,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: webhookSendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      MockedSlackChannel.mockImplementation(
        () =>
          ({
            send: slackSendMock,
          }) as unknown as InstanceType<typeof SlackChannel>,
      );

      const channels = [makeWebhookConfig(), makeSlackConfig()];
      const dispatcher = new NotificationDispatcher(channels);
      const payload = makePayload();

      const result = await dispatcher.dispatch(payload);

      expect(webhookSendMock).toHaveBeenCalledWith(payload);
      expect(slackSendMock).toHaveBeenCalledWith(payload);
      expect(result.results).toHaveLength(2);
      expect(result.allSucceeded).toBe(true);
      expect(result.payload).toEqual(payload);
    });

    it("continues on individual channel failure (fan-out resilience)", async () => {
      const webhookSendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: false,
        error: "Connection timeout",
      });
      const slackSendMock = vi.fn().mockResolvedValue({
        channelType: "slack",
        success: true,
        responseStatus: 200,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: webhookSendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      MockedSlackChannel.mockImplementation(
        () =>
          ({
            send: slackSendMock,
          }) as unknown as InstanceType<typeof SlackChannel>,
      );

      const channels = [makeWebhookConfig(), makeSlackConfig()];
      const dispatcher = new NotificationDispatcher(channels);
      const payload = makePayload();

      const result = await dispatcher.dispatch(payload);

      expect(webhookSendMock).toHaveBeenCalled();
      expect(slackSendMock).toHaveBeenCalled();
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(false);
      expect(result.results[1].success).toBe(true);
      expect(result.allSucceeded).toBe(false);
    });

    it("returns per-channel results", async () => {
      const webhookResult: NotificationResult = {
        channelType: "webhook",
        success: true,
        responseStatus: 200,
      };
      const slackResult: NotificationResult = {
        channelType: "slack",
        success: true,
        responseStatus: 200,
      };
      const emailResult: NotificationResult = {
        channelType: "email",
        success: false,
        error: "SMTP authentication failed",
      };

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: vi.fn().mockResolvedValue(webhookResult),
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      MockedSlackChannel.mockImplementation(
        () =>
          ({
            send: vi.fn().mockResolvedValue(slackResult),
          }) as unknown as InstanceType<typeof SlackChannel>,
      );

      MockedEmailChannel.mockImplementation(
        () =>
          ({
            send: vi.fn().mockResolvedValue(emailResult),
          }) as unknown as InstanceType<typeof EmailChannel>,
      );

      const channels = [makeWebhookConfig(), makeSlackConfig(), makeEmailConfig()];
      const dispatcher = new NotificationDispatcher(channels);
      const payload = makePayload();

      const result = await dispatcher.dispatch(payload);

      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toEqual(webhookResult);
      expect(result.results[1]).toEqual(slackResult);
      expect(result.results[2]).toEqual(emailResult);
      expect(result.allSucceeded).toBe(false);
    });

    it("handles unknown channel type gracefully", async () => {
      const unknownChannel = {
        type: "unknown" as NotificationChannelConfig["type"],
      } as NotificationChannelConfig;

      const dispatcher = new NotificationDispatcher([unknownChannel]);
      const payload = makePayload();

      const result = await dispatcher.dispatch(payload);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("Unknown channel type");
    });

    it("returns empty results when no channels configured", async () => {
      const dispatcher = new NotificationDispatcher([]);
      const payload = makePayload();

      const result = await dispatcher.dispatch(payload);

      expect(result.results).toHaveLength(0);
      expect(result.allSucceeded).toBe(true);
      expect(result.payload).toEqual(payload);
    });
  });

  describe("dispatchAnomalyAlerts", () => {
    it("formats anomaly payload correctly", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const anomaly = makeAnomaly({
        metric: "cpc",
        currentValue: 5.0,
        historicalMean: 2.0,
        historicalStdDev: 0.5,
        zScore: 6.0,
        severity: "critical",
        message: "CPC is unusually high",
      });

      await dispatcher.dispatchAnomalyAlerts("acc_123", [anomaly]);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const calledPayload = sendMock.mock.calls[0][0];

      expect(calledPayload.alertType).toBe("anomaly");
      expect(calledPayload.severity).toBe("critical");
      expect(calledPayload.accountId).toBe("acc_123");
      expect(calledPayload.title).toBe("Anomaly Detected: cpc");
      expect(calledPayload.message).toBe("CPC is unusually high");
      expect(calledPayload.details).toEqual({
        metric: "cpc",
        currentValue: 5.0,
        historicalMean: 2.0,
        historicalStdDev: 0.5,
        zScore: 6.0,
      });
      expect(calledPayload.timestamp).toBeDefined();
    });

    it("dispatches multiple anomalies independently", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const anomalies = [
        makeAnomaly({ metric: "ctr", severity: "critical" }),
        makeAnomaly({ metric: "cpc", severity: "warning" }),
      ];

      const results = await dispatcher.dispatchAnomalyAlerts("acc_123", anomalies);

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results[0].payload.title).toBe("Anomaly Detected: ctr");
      expect(results[1].payload.title).toBe("Anomaly Detected: cpc");
    });

    it("returns empty array for empty anomalies", async () => {
      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);

      const results = await dispatcher.dispatchAnomalyAlerts("acc_123", []);

      expect(results).toHaveLength(0);
    });
  });

  describe("dispatchBudgetAlerts", () => {
    it("formats budget forecast payload correctly", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "slack",
        success: true,
      });

      MockedSlackChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof SlackChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeSlackConfig()]);
      const forecast = makeBudgetForecast({
        campaignId: "camp_456",
        campaignName: "Holiday Sale",
        dailyBudget: 200,
        dailySpendRate: 250,
        remainingBudget: 1000,
        daysUntilExhaustion: 4,
        projectedMonthlySpend: 7500,
        status: "budget_exhausting",
        recommendations: ["Increase budget immediately", "Pause low-performing ads"],
      });

      await dispatcher.dispatchBudgetAlerts("acc_456", [forecast]);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const calledPayload = sendMock.mock.calls[0][0];

      expect(calledPayload.alertType).toBe("budget_forecast");
      expect(calledPayload.severity).toBe("critical");
      expect(calledPayload.accountId).toBe("acc_456");
      expect(calledPayload.title).toBe("Budget Alert: Holiday Sale");
      expect(calledPayload.message).toBe("Increase budget immediately Pause low-performing ads");
      expect(calledPayload.details).toEqual({
        campaignId: "camp_456",
        campaignName: "Holiday Sale",
        dailyBudget: 200,
        dailySpendRate: 250,
        remainingBudget: 1000,
        daysUntilExhaustion: 4,
        projectedMonthlySpend: 7500,
        status: "budget_exhausting",
      });
    });

    it("maps budget status to severity correctly", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);

      const forecasts = [
        makeBudgetForecast({ status: "budget_exhausting" }),
        makeBudgetForecast({ status: "overspending" }),
        makeBudgetForecast({ status: "underspending" }),
      ];

      await dispatcher.dispatchBudgetAlerts("acc_123", forecasts);

      expect(sendMock).toHaveBeenCalledTimes(3);
      expect(sendMock.mock.calls[0][0].severity).toBe("critical");
      expect(sendMock.mock.calls[1][0].severity).toBe("warning");
      expect(sendMock.mock.calls[2][0].severity).toBe("info");
    });

    it("skips healthy forecasts", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const forecasts = [
        makeBudgetForecast({ status: "healthy" }),
        makeBudgetForecast({ status: "overspending" }),
      ];

      const results = await dispatcher.dispatchBudgetAlerts("acc_123", forecasts);

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].payload.details).toMatchObject({ status: "overspending" });
    });

    it("returns empty array for all healthy forecasts", async () => {
      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const forecasts = [
        makeBudgetForecast({ status: "healthy" }),
        makeBudgetForecast({ status: "healthy" }),
      ];

      const results = await dispatcher.dispatchBudgetAlerts("acc_123", forecasts);

      expect(results).toHaveLength(0);
    });
  });

  describe("dispatchPolicyAlerts", () => {
    it("dispatches disapproved ads as critical", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "email",
        success: true,
      });

      MockedEmailChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof EmailChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeEmailConfig()]);
      const scanResult = makePolicyScanResult({
        overallHealthy: false,
        disapprovedAds: [
          { adId: "ad_1", adName: "Ad One", reason: "Prohibited content" },
          { adId: "ad_2", adName: "Ad Two", reason: "Misleading claims" },
        ],
      });

      await dispatcher.dispatchPolicyAlerts("acc_789", scanResult);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const calledPayload = sendMock.mock.calls[0][0];

      expect(calledPayload.alertType).toBe("policy_violation");
      expect(calledPayload.severity).toBe("critical");
      expect(calledPayload.title).toBe("2 Disapproved Ad(s)");
      expect(calledPayload.message).toContain("Ad One (ad_1): Prohibited content");
      expect(calledPayload.message).toContain("Ad Two (ad_2): Misleading claims");
      expect(calledPayload.details).toMatchObject({
        disapprovedCount: 2,
        ads: scanResult.disapprovedAds,
      });
    });

    it("dispatches spend limit warning separately", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const scanResult = makePolicyScanResult({
        overallHealthy: false,
        spendLimitApproaching: true,
        issues: ["Account spend limit approaching 90%"],
      });

      await dispatcher.dispatchPolicyAlerts("acc_789", scanResult);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const calledPayload = sendMock.mock.calls[0][0];

      expect(calledPayload.alertType).toBe("policy_violation");
      expect(calledPayload.severity).toBe("warning");
      expect(calledPayload.title).toBe("Account Spend Limit Approaching");
      expect(calledPayload.message).toContain("Account spend limit approaching 90%");
      expect(calledPayload.details).toMatchObject({
        spendLimitApproaching: true,
      });
    });

    it("dispatches policy warnings as info", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const scanResult = makePolicyScanResult({
        overallHealthy: false,
        policyWarnings: [
          { entityType: "ad", entityId: "ad_1", warning: "Low quality score" },
          { entityType: "campaign", entityId: "camp_1", warning: "Missing tracking pixel" },
        ],
      });

      await dispatcher.dispatchPolicyAlerts("acc_789", scanResult);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const calledPayload = sendMock.mock.calls[0][0];

      expect(calledPayload.alertType).toBe("policy_violation");
      expect(calledPayload.severity).toBe("info");
      expect(calledPayload.title).toBe("2 Policy Warning(s)");
      expect(calledPayload.message).toContain("ad ad_1: Low quality score");
      expect(calledPayload.message).toContain("campaign camp_1: Missing tracking pixel");
      expect(calledPayload.details).toMatchObject({
        warningCount: 2,
        warnings: scanResult.policyWarnings,
      });
    });

    it("dispatches multiple alerts when multiple issues present", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const scanResult = makePolicyScanResult({
        overallHealthy: false,
        disapprovedAds: [{ adId: "ad_1", adName: "Ad One", reason: "Policy violation" }],
        spendLimitApproaching: true,
        issues: ["Spend limit at 95%"],
      });

      const results = await dispatcher.dispatchPolicyAlerts("acc_789", scanResult);

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results[0].payload.severity).toBe("critical");
      expect(results[1].payload.severity).toBe("warning");
    });

    it("does not dispatch warnings if disapproved ads or spend limit present", async () => {
      const sendMock = vi.fn().mockResolvedValue({
        channelType: "webhook",
        success: true,
      });

      MockedWebhookChannel.mockImplementation(
        () =>
          ({
            send: sendMock,
          }) as unknown as InstanceType<typeof WebhookChannel>,
      );

      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const scanResult = makePolicyScanResult({
        overallHealthy: false,
        disapprovedAds: [{ adId: "ad_1", adName: "Ad One", reason: "Policy violation" }],
        policyWarnings: [{ entityType: "ad", entityId: "ad_2", warning: "Low quality" }],
      });

      const results = await dispatcher.dispatchPolicyAlerts("acc_789", scanResult);

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].payload.severity).toBe("critical");
    });

    it("returns empty array when overall healthy", async () => {
      const dispatcher = new NotificationDispatcher([makeWebhookConfig()]);
      const scanResult = makePolicyScanResult({ overallHealthy: true });

      const results = await dispatcher.dispatchPolicyAlerts("acc_789", scanResult);

      expect(results).toHaveLength(0);
    });
  });
});
