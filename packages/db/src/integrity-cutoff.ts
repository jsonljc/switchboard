/**
 * The instant at which WorkTrace integrity hashing went live.
 *
 * This is the **migration commit timestamp**, baked in as a literal string,
 * not derived at runtime from when the migration ran. That makes the cutoff
 * deterministic across dev / staging / prod regardless of when each
 * environment migrates.
 *
 * Verification semantics (see packages/core/src/platform/work-trace-integrity.ts):
 * - Rows with `requestedAt < CUTOFF_AT` AND `contentHash IS NULL`
 *   → integrity verdict "skipped" reason "pre_migration"
 * - Rows with `requestedAt >= CUTOFF_AT` AND `contentHash IS NULL`
 *   → integrity verdict "missing_anchor" + alert
 *
 * Execution admission rejects "skipped" unconditionally. Pre-migration
 * traces are read-visible but cannot drive new external effects.
 */
export const WORK_TRACE_INTEGRITY_CUTOFF_AT = "2026-04-29T07:12:48.000Z";
