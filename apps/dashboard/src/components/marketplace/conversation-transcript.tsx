import { cn } from "@/lib/utils";

interface Message {
  role: "lead" | "agent" | "owner";
  text: string;
  timestamp: string;
}

interface ConversationTranscriptProps {
  messages: Message[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ConversationTranscript({ messages }: ConversationTranscriptProps) {
  return (
    <div className="space-y-3 py-4">
      {messages.map((msg, i) => (
        <div key={i} className={cn("flex", msg.role === "lead" ? "justify-start" : "justify-end")}>
          <div
            className={cn(
              "max-w-[80%] rounded-lg px-3 py-2",
              msg.role === "lead" && "bg-border/20",
              msg.role === "agent" && "bg-surface-raised",
              msg.role === "owner" && "bg-blue-500/10 border border-blue-500/20",
            )}
          >
            {msg.role === "owner" && (
              <p className="text-[10px] font-medium text-blue-600 mb-0.5">You</p>
            )}
            <p className="text-sm">{msg.text}</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {formatTime(msg.timestamp)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
