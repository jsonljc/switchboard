// ---------------------------------------------------------------------------
// Image Generator — Interface for creative image generation
// ---------------------------------------------------------------------------
// Provides a typed interface for generating images from prompts.
// Includes a MockImageGenerator for testing and an OpenAIImageGenerator
// for production use (config-gated).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageGenerateOptions {
  width?: number;
  height?: number;
  style?: "natural" | "vivid";
  format?: "png" | "jpeg" | "webp";
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  width: number;
  height: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// ImageGenerator interface
// ---------------------------------------------------------------------------

export interface ImageGenerator {
  generate(prompt: string, options?: ImageGenerateOptions): Promise<GeneratedImage>;
}

// ---------------------------------------------------------------------------
// MockImageGenerator — Returns placeholder images (for testing)
// ---------------------------------------------------------------------------

export class MockImageGenerator implements ImageGenerator {
  private callCount = 0;

  async generate(prompt: string, options?: ImageGenerateOptions): Promise<GeneratedImage> {
    this.callCount++;
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;

    return {
      id: `mock-img-${this.callCount}`,
      url: `https://placeholder.test/img/${this.callCount}/${width}x${height}`,
      prompt,
      width,
      height,
      generatedAt: new Date().toISOString(),
    };
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ---------------------------------------------------------------------------
// OpenAIImageGenerator — Calls DALL-E API (config-gated)
// ---------------------------------------------------------------------------

export interface OpenAIImageConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAIImageGenerator implements ImageGenerator {
  private readonly config: OpenAIImageConfig;

  constructor(config: OpenAIImageConfig) {
    this.config = config;
  }

  async generate(prompt: string, options?: ImageGenerateOptions): Promise<GeneratedImage> {
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;
    const model = this.config.model ?? "dall-e-3";
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com/v1";

    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: `${width}x${height}`,
        style: options?.style ?? "natural",
        response_format: "url",
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI image generation failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ url: string; revised_prompt?: string }>;
    };
    const image = data.data[0];
    if (!image) {
      throw new Error("OpenAI returned empty image data");
    }

    return {
      id: crypto.randomUUID(),
      url: image.url,
      prompt: image.revised_prompt ?? prompt,
      width,
      height,
      generatedAt: new Date().toISOString(),
    };
  }
}
