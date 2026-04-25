export interface ServiceFieldConfig {
  key: string;
  label: string;
  type: "text" | "password";
  required: boolean;
  placeholder: string;
  helpText?: string;
}

export interface ServiceConnectionConfig {
  fields: ServiceFieldConfig[];
  oauth?: {
    label: string;
    getUrl: (deploymentId?: string) => string;
  };
}

export const SERVICE_CONNECTION_CONFIGS: Record<string, ServiceConnectionConfig> = {
  "meta-ads": {
    fields: [
      {
        key: "accessToken",
        label: "Access Token",
        type: "password",
        required: true,
        placeholder: "System User token from Meta Business Suite",
        helpText: "Go to Business Settings > System Users > Generate Token",
      },
      {
        key: "accountId",
        label: "Ad Account ID",
        type: "text",
        required: true,
        placeholder: "act_123456789",
        helpText: "Found in Ads Manager > Account Overview",
      },
      {
        key: "pixelId",
        label: "Pixel ID",
        type: "text",
        required: false,
        placeholder: "123456789",
        helpText: "Found in Events Manager (optional)",
      },
    ],
    oauth: {
      label: "Connect with Meta",
      getUrl: (deploymentId) =>
        `/api/dashboard/connections/facebook/authorize${deploymentId ? `?deploymentId=${deploymentId}` : ""}`,
    },
  },
  google_calendar: {
    fields: [],
    oauth: {
      label: "Connect Google Calendar",
      getUrl: (deploymentId) =>
        `/api/dashboard/connections/google-calendar/authorize${deploymentId ? `?deploymentId=${deploymentId}` : ""}`,
    },
  },
};

export const SERVICE_FIELD_CONFIGS: Record<string, ServiceFieldConfig[]> = Object.fromEntries(
  Object.entries(SERVICE_CONNECTION_CONFIGS).map(([k, v]) => [k, v.fields]),
);
