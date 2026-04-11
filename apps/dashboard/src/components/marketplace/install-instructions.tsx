"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Platform = "shopify" | "wordpress" | "wix" | "squarespace" | "custom" | null;

interface InstallInstructionsProps {
  widgetToken: string;
  chatServerUrl: string;
  platform?: Platform;
}

interface PlatformConfig {
  label: string;
  steps: string[];
}

const PLATFORM_CONFIGS: Record<Exclude<Platform, null | "custom">, PlatformConfig> = {
  shopify: {
    label: "Shopify",
    steps: [
      "In your Shopify admin, go to Online Store → Themes.",
      'Click "Actions" → "Edit code" on your active theme.',
      "Open the theme.liquid file.",
      "Paste the embed code just before the closing </body> tag.",
      'Click "Save" to apply changes.',
    ],
  },
  wordpress: {
    label: "WordPress",
    steps: [
      "Install a header/footer plugin (e.g., Insert Headers and Footers).",
      "In your WordPress admin, open the plugin settings.",
      'Paste the embed code in the "Footer Scripts" field.',
      "Save the settings — the widget will appear on all pages.",
    ],
  },
  wix: {
    label: "Wix",
    steps: [
      'In the Wix Editor, click "Add" → "Embed" → "Custom Embeds".',
      'Select "Embed a Widget".',
      "Paste the embed code into the HTML/code editor.",
      'Click "Apply" and then publish your site.',
    ],
  },
  squarespace: {
    label: "Squarespace",
    steps: [
      "Go to Settings → Advanced → Code Injection.",
      "Paste the embed code in the Footer field.",
      "Click Save — the widget loads on every page.",
    ],
  },
};

const CUSTOM_STEPS: string[] = [
  "Copy the embed code above.",
  "Open the HTML source of your page in your editor.",
  "Paste the code just before the closing </body> tag.",
  "Publish or deploy your updated page.",
];

function getSteps(platform: Platform): { label: string; steps: string[] } {
  if (!platform || platform === "custom") {
    return { label: "Generic", steps: CUSTOM_STEPS };
  }
  return PLATFORM_CONFIGS[platform];
}

export function InstallInstructions({
  widgetToken,
  chatServerUrl,
  platform,
}: InstallInstructionsProps) {
  const [copied, setCopied] = useState(false);

  const embedCode = `<script src="${chatServerUrl}/widget.js" data-token="${widgetToken}" async></script>`;

  const { label, steps } = getSteps(platform ?? null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — silently ignore
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Installation Instructions</CardTitle>
          {platform && platform !== "custom" && (
            <Badge variant="secondary">{PLATFORM_CONFIGS[platform].label}</Badge>
          )}
          {(!platform || platform === "custom") && <Badge variant="outline">Generic</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Embed code block */}
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Embed Code</p>
          <div className="relative rounded-md border bg-muted">
            <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed">{embedCode}</pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute right-2 top-2 h-7 w-7 p-0"
              onClick={handleCopy}
              aria-label="Copy embed code"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Platform-specific steps */}
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            {platform && platform !== "custom" ? `${label} Setup Steps` : "Installation Steps"}
          </p>
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="leading-5 text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
