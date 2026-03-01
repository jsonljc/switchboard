export interface SecurityStore {
  checkNonce(nonce: string, ttlMs: number): Promise<boolean>;
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
}
