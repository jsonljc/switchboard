// Re-exported from the editorial query-states primitive so every existing
// `@/components/ui/skeleton` importer gets the token-correct version (audit B1:
// the old impl used the shadcn `bg-muted`). New code should import from
// `@/components/query-states`.
export { Skeleton } from "@/components/query-states/skeleton";
