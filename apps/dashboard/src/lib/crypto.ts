// apiKey crypto is canonical in @switchboard/db (packages/db/src/crypto/api-key.ts).
// This module re-exports it so the dashboard request path (get-api-client.ts) and any
// other dashboard caller use the single source. The db golden test pins byte-compat
// with apiKeys already at rest. Do NOT re-add a local impl here — drift would make
// every previously-stored apiKey undecryptable at request time.
export { encryptApiKey, decryptApiKey } from "@switchboard/db";
