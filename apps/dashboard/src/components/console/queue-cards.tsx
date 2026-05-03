/**
 * Compatibility shim: re-exports from queue-cards/ directory.
 *
 * This file exists only because Node/TypeScript resolves a `.tsx` file before
 * a same-named directory's `index.tsx`. Task 15 will delete this shim once the
 * old API is fully removed and the directory index is the sole entry point.
 */
export * from "./queue-cards/index";
