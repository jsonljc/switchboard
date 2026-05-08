/**
 * Subset of @switchboard/schemas AgentKey that has agent-home pages in Slice B.
 * Mira (`launchTier: "day-thirty"`) is intentionally excluded — its agent home
 * ships in a future slice.
 */
export type AgentHomeKey = "alex" | "riley";
