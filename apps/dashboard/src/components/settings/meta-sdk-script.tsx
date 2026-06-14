"use client";

import Script from "next/script";

/**
 * Loads Meta's JavaScript SDK and initializes window.FB for the operator Meta
 * connection flow (WhatsApp embedded signup on the settings page).
 *
 * Mounted ONLY by the (auth) route-group layout, so the SDK never loads on the
 * unauthenticated surface (patient payment pages, /welcome, /privacy, /terms,
 * /login, password reset). The window.FB type lives in src/types/facebook.d.ts.
 *
 * The env var is read as a static member access so Next.js inlines it
 * client-side; a dynamic bracket read would be undefined in the browser.
 */
export function MetaSdkScript() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId) return null;

  return (
    <Script
      id="meta-facebook-sdk"
      src="https://connect.facebook.net/en_US/sdk.js"
      strategy="lazyOnload"
      onLoad={() => {
        window.FB?.init({
          appId,
          cookie: true,
          xfbml: true,
          version: "v21.0",
        });
      }}
    />
  );
}
