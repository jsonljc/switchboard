// apps/dashboard/src/lib/cockpit/mission-types.ts
export type MissionChannelKind = "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar";
export type MissionChannelStatus = "ok" | "warn" | "off";

export type MissionChannel = {
  kind: MissionChannelKind;
  label: string;
  status: MissionChannelStatus;
};

export type MissionRules = {
  priceApprovalThreshold: number;
  refundEscalationFloor: number;
} | null;

export type MissionTargets = {
  avgValueCents: number | null;
  targetCpbCents: number | null;
  roasSource: "deterministic" | "crm";
};

export type MissionSetupRow = {
  key: "meta" | "inbox" | "cal" | "rules";
  done: boolean;
  primary?: boolean;
};

export type MissionAggregatorResponse = {
  agentKey: "alex" | "riley";
  displayName: string;
  mission: {
    role: string;
    pipeline: string;
    brand: string;
    channels: MissionChannel[];
    rules: MissionRules;
  };
  composerPlaceholder: string;
  commands: never[];
  targets: MissionTargets;
  setup: MissionSetupRow[];
};
