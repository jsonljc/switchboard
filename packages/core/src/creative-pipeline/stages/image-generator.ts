// packages/core/src/creative-pipeline/stages/image-generator.ts
import OpenAI from "openai";

/**
 * Pluggable interface for image generation.
 * Implementations return a URL to the generated image.
 */
export interface ImageGenerator {
  generate(prompt: string): Promise<string>;
}

/**
 * DALL-E 3 implementation of ImageGenerator.
 * Generates 1024x1024 images in "vivid" style using the OpenAI SDK.
 */
export class DalleImageGenerator implements ImageGenerator {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(prompt: string): Promise<string> {
    const response = await this.client.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      style: "vivid",
    });

    const imageData = response.data[0];
    if (!imageData) {
      throw new Error("No image data returned from DALL-E");
    }

    if (!imageData.url) {
      throw new Error("No image URL returned from DALL-E");
    }

    return imageData.url;
  }
}
