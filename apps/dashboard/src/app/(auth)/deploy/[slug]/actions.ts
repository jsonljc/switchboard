"use server";

import Anthropic from "@anthropic-ai/sdk";

interface BusinessProfile {
  businessName: string;
  whatTheySell: string;
  valueProposition: string;
  tone: string;
  pricingRange: string;
}

export async function scanWebsite(url: string): Promise<BusinessProfile> {
  // Fetch the website
  const response = await fetch(url, {
    headers: { "User-Agent": "Switchboard/1.0 (business scanner)" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.status}`);
  }

  const html = await response.text();

  // Extract text content (simple approach — strip HTML tags)
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000); // Limit to ~5k chars

  // Extract from Claude
  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Analyze this business website content and extract:
1. Business name
2. What they sell (products/services)
3. Value proposition (what makes them special)
4. Tone of their brand (e.g., warm, professional, playful)
5. Pricing range (if visible)

Website content:
${textContent}

Respond in JSON format only:
{"businessName": "", "whatTheySell": "", "valueProposition": "", "tone": "", "pricingRange": ""}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse business profile from AI response");
  }

  return JSON.parse(jsonMatch[0]) as BusinessProfile;
}
