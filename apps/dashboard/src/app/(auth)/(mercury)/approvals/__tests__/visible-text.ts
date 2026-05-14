/**
 * Returns the visible text content of the current DOM, excluding decorative
 * (aria-hidden), inline scripts/styles, and the confirmation-code value
 * (which legitimately renders a hex string).
 *
 * Use this in copy-language audits and any test that asserts on rendered
 * customer-facing copy.
 */
export function visibleText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      '[aria-hidden="true"], script, style, [data-testid="confirmation-code-value"]',
    )
    .forEach((el) => el.remove());
  return clone.textContent ?? "";
}
