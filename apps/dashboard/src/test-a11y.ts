// Shared a11y test harness. Importing this registers vitest-axe's
// `toHaveNoViolations` matcher and re-exports an axe runner. Scoped to a11y test
// files (not the global test-setup) so axe-core is only loaded by workers that
// actually run accessibility checks.
//
// jsdom has no layout engine, so axe's `color-contrast` rule cannot run here and
// is disabled — contrast must be verified against the running app. Everything
// structural (roles, names, labels, aria-*, focus order, dialog semantics) IS
// checked, which is the bulk of keyboard / screen-reader accessibility.
import { expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";

expect.extend(axeMatchers);

// vitest-axe@0.1.0's bundled `extend-expect` type augmentation predates vitest
// 2.x's `Assertion` interface, so its `toHaveNoViolations` does not attach.
// Declare it explicitly. The `T = any` default must match vitest's own
// `Assertion<T = any>` signature exactly (TS2428), so `any` is required here.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> {
    toHaveNoViolations(): T;
  }
}

/** axe options tuned for jsdom: color-contrast needs real layout, so skip it. */
const A11Y_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

/** Run axe over a rendered container with the jsdom-safe rule set. */
export function checkA11y(container: Element) {
  return axe(container, A11Y_OPTIONS);
}
