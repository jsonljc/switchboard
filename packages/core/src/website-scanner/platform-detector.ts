type Platform = "shopify" | "wordpress" | "wix" | "squarespace";

interface PlatformSignal {
  platform: Platform;
  pattern: RegExp;
}

const SIGNALS: PlatformSignal[] = [
  { platform: "shopify", pattern: /cdn\.shopify\.com/i },
  { platform: "shopify", pattern: /shopify-digital-wallet/i },
  { platform: "shopify", pattern: /Shopify\.theme/i },

  { platform: "wordpress", pattern: /name="generator"\s+content="WordPress/i },
  { platform: "wordpress", pattern: /\/wp-content\//i },
  { platform: "wordpress", pattern: /\/wp-includes\//i },

  { platform: "wix", pattern: /content="Wix\.com/i },
  { platform: "wix", pattern: /wix-code-sdk/i },
  { platform: "wix", pattern: /static\.wixstatic\.com/i },

  { platform: "squarespace", pattern: /squarespace\.com/i },
  { platform: "squarespace", pattern: /content="Squarespace/i },
];

export function detectPlatform(html: string): Platform | undefined {
  if (!html) return undefined;

  for (const signal of SIGNALS) {
    if (signal.pattern.test(html)) {
      return signal.platform;
    }
  }

  return undefined;
}
