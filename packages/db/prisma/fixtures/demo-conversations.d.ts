/**
 * Pre-generated demo conversation transcripts for marketplace agents.
 * Used to populate realistic task data for "Austin Bakery Co" demo instance.
 */
export interface DemoMessage {
  role: "lead" | "agent";
  text: string;
  minutesOffset: number;
}
export interface DemoConversation {
  agentSlug: string;
  category: string;
  summary: string;
  outcome: "qualified" | "disqualified" | "booked" | "escalated";
  handoffTo?: string;
  reviewStatus: "approved" | "rejected";
  messages: DemoMessage[];
  minutesAgo: number;
}
export declare const DEMO_CONVERSATIONS: DemoConversation[];
//# sourceMappingURL=demo-conversations.d.ts.map
