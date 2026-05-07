// Meta pixel ids are 15–16 digit numeric strings. The bound is tight on
// purpose: a too-loose validator will accept malformed values that pass
// the form but fail later in the Gap 2 signal-health cron with an opaque
// Graph API error.
export const PIXEL_ID_PATTERN = /^\d{15,16}$/;

export function isValidPixelId(value: string): boolean {
  return PIXEL_ID_PATTERN.test(value);
}
