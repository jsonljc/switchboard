/**
 * HeyGen avatar video client — stubbed for V1 (Premium tier).
 * Will be implemented in V2 when Premium tier is exposed.
 */

interface HeyGenConfig {
  apiKey: string;
}

interface GenerateAvatarRequest {
  script: string;
  avatarId?: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
}

interface GenerateAvatarResult {
  videoUrl: string;
  duration: number;
}

export class HeyGenClient {
  constructor(_config: HeyGenConfig) {}

  async generateAvatar(_request: GenerateAvatarRequest): Promise<GenerateAvatarResult> {
    throw new Error("HeyGen integration is not yet available (Premium tier — V2)");
  }
}
