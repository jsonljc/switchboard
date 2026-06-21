// Thin re-export: /results Colophon now delegates to the shared implementation.
// The shared Colophon accepts { period, label?, org?, isLive?, generatedAt } —
// matching the /results call shape exactly.
export { Colophon } from "@/components/reports-shared/colophon";
