import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the props next/script receives without depending on lazyOnload's
// deferred injection in jsdom. vi.hoisted lets the mock factory (hoisted above
// imports) reference this array.
const { scriptProps } = vi.hoisted(() => ({
  scriptProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/script", () => ({
  default: (props: Record<string, unknown>) => {
    scriptProps.push(props);
    return null;
  },
}));

import { MetaSdkScript } from "@/components/settings/meta-sdk-script";

describe("MetaSdkScript", () => {
  beforeEach(() => {
    scriptProps.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders nothing when NEXT_PUBLIC_META_APP_ID is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "");
    render(<MetaSdkScript />);
    expect(scriptProps).toHaveLength(0);
  });

  it("loads the Facebook SDK with a stable id and lazyOnload when the app id is set", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app-id");
    render(<MetaSdkScript />);
    expect(scriptProps).toHaveLength(1);
    expect(scriptProps[0].id).toBe("meta-facebook-sdk");
    expect(scriptProps[0].src).toBe("https://connect.facebook.net/en_US/sdk.js");
    expect(scriptProps[0].strategy).toBe("lazyOnload");
  });

  it("initializes window.FB with the app id when the script loads", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app-id");
    const init = vi.fn();
    vi.stubGlobal("FB", { init });
    render(<MetaSdkScript />);
    (scriptProps[0].onLoad as () => void)();
    expect(init).toHaveBeenCalledWith({
      appId: "test-app-id",
      cookie: true,
      xfbml: true,
      version: "v21.0",
    });
  });

  it("does not throw on load when window.FB is unavailable", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app-id");
    render(<MetaSdkScript />);
    expect(() => (scriptProps[0].onLoad as () => void)()).not.toThrow();
  });
});
