export const STATUS_DOT: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active",
  analyzing: "bg-agent-active",
  waiting_approval: "bg-agent-attention",
  error: "bg-destructive",
};

export const STATUS_DOT_ANIMATED: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active animate-pulse",
  analyzing: "bg-agent-active animate-pulse",
  waiting_approval: "bg-agent-attention animate-pulse",
  error: "bg-destructive animate-pulse",
};

export const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  working: "Working",
  analyzing: "Analyzing",
  waiting_approval: "Waiting",
  error: "Error",
};
