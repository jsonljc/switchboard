/**
 * Telegram's Bot API limits inline-button `callback_data` to 1-64 *bytes* (UTF-8).
 * When any button in a `sendMessage` exceeds it, Telegram rejects the ENTIRE
 * request (HTTP 400 `BUTTON_DATA_INVALID`) and the operator never sees the card at
 * all — a silent loss of the approve/reject control-plane action (CHAN-4 / BUG-4).
 *
 * Approval `callback_data` carries `{action, approvalId, bindingHash}` as JSON
 * (~150 bytes for a real `appr_<uuid>` id + a sha256 binding hash), so it never
 * fits. Producers must check before sending and, when the keyboard is
 * undeliverable, omit it and fall back to a dashboard instruction rather than
 * letting the whole card vanish.
 */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

/** True when `callbackData` fits Telegram's 64-byte inline-button limit. */
export function isWithinTelegramCallbackLimit(callbackData: string): boolean {
  return Buffer.byteLength(callbackData, "utf8") <= TELEGRAM_CALLBACK_DATA_MAX_BYTES;
}

/**
 * Appended to the approval card text when the inline keyboard is omitted because
 * its `callback_data` exceeds the limit, so the operator still sees the approval
 * and knows where to action it.
 */
export const TELEGRAM_APPROVAL_DASHBOARD_FALLBACK =
  "Approve or reject this from the dashboard (it can't be actioned from Telegram).";
