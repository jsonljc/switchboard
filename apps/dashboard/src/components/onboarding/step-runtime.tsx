"use client";

const runtimes = [
  {
    value: "openclaw",
    label: "OpenClaw",
    description: "Connect your OpenClaw agent with governed tools via MCP server.",
    icon: "terminal",
  },
  {
    value: "mcp",
    label: "Claude with tools",
    description: "Use Switchboard as an MCP server in Claude Desktop or Cursor.",
    icon: "bot",
  },
  {
    value: "http",
    label: "HTTP API",
    description: "Call the Switchboard REST API directly from your application.",
    icon: "globe",
  },
  {
    value: "managed",
    label: "Set it up for me",
    description: "We'll host a chat interface with messaging integrations.",
    icon: "message-circle",
  },
];

interface StepRuntimeProps {
  selected: string;
  onChange: (value: string) => void;
}

export function StepRuntime({ selected, onChange }: StepRuntimeProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        How will your AI agent connect to Switchboard?
      </p>
      {runtimes.map((runtime) => (
        <button
          key={runtime.value}
          onClick={() => onChange(runtime.value)}
          className={`w-full text-left p-4 rounded-lg border transition-colors ${
            selected === runtime.value
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50"
          }`}
        >
          <span className="font-medium text-sm">{runtime.label}</span>
          <p className="text-xs text-muted-foreground mt-1">{runtime.description}</p>
        </button>
      ))}
    </div>
  );
}
