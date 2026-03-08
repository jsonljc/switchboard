// ---------------------------------------------------------------------------
// Notification Delivery Types — Channel configs, payloads, and results
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Channel configuration
// ---------------------------------------------------------------------------

export type NotificationChannelType = 'webhook' | 'slack' | 'email';

export interface WebhookChannelConfig {
  type: 'webhook';
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT';
}

export interface SlackChannelConfig {
  type: 'slack';
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

export interface EmailChannelConfig {
  type: 'email';
  smtpHost: string;
  smtpPort: number;
  from: string;
  to: string[];
  useTls?: boolean;
  auth?: { user: string; pass: string };
}

export type NotificationChannelConfig = WebhookChannelConfig | SlackChannelConfig | EmailChannelConfig;

// ---------------------------------------------------------------------------
// Notification payload
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  alertType: 'anomaly' | 'budget_forecast' | 'policy_violation';
  severity: 'critical' | 'warning' | 'info';
  accountId: string;
  title: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Notification results
// ---------------------------------------------------------------------------

export interface NotificationResult {
  channelType: NotificationChannelType;
  success: boolean;
  error?: string;
  responseStatus?: number;
}

export interface NotificationDispatchResult {
  payload: NotificationPayload;
  results: NotificationResult[];
  allSucceeded: boolean;
}
