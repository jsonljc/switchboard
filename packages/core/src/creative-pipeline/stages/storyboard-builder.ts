// packages/core/src/creative-pipeline/stages/storyboard-builder.ts
import { callClaude } from "./call-claude.js";
import { StoryboardOutput } from "@switchboard/schemas";
import type { ScriptWriterOutput } from "@switchboard/schemas";
import type { ImageGenerator } from "./image-generator.js";

interface StoryboardBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  productImages?: string[];
}

export function buildStoryboardPrompt(
  brief: StoryboardBrief,
  scriptsOutput: ScriptWriterOutput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are an expert creative director who transforms ad scripts into detailed scene-by-scene storyboards with precise visual direction.

Your job is to break each script into 4-6 scenes, mapping to the script's timing structure. Each scene gets detailed visual direction that a production team can execute.

## Scene Mapping

Map script sections to scenes:
- **Hook** section → Scene 1 (the scroll-stopper)
- **Problem** section → Scene 2 (visualize the pain)
- **Solution** section → Scenes 3-4 (show the product in action)
- **Proof** section → Scene 4-5 (social proof, results)
- **CTA** section → Final scene (clear call to action)

Combine or split sections as needed to hit 4-6 scenes per script.

## Visual Direction

For each scene, specify:
- **Camera angle:** wide, medium, close-up, over-the-shoulder, POV, etc.
- **Lighting:** natural, studio, warm, cool, dramatic, etc.
- **Mood:** energetic, calm, urgent, aspirational, etc.
- **Composition:** rule of thirds, centered, leading lines, etc.
- **Talent direction:** facial expression, action, positioning

## Output Format

Return a JSON object with exactly this structure:

{
  "storyboards": [
    {
      "scriptRef": "0",
      "scenes": [
        {
          "sceneNumber": 1,
          "description": "What happens in this scene",
          "visualDirection": "Camera: close-up. Lighting: warm overhead. Mood: frustrated. Composition: centered face, blurred background. Talent: furrowed brow, looking at phone.",
          "duration": 3,
          "textOverlay": "Text shown on screen, or null if none",
          "referenceImageUrl": null
        }
      ]
    }
  ]
}

Guidelines:
- Create one storyboard per script
- 4-6 scenes per storyboard
- Scene durations should roughly match the script timing sections
- Total scene durations should sum to the script's total duration
- textOverlay is null when no text appears on screen
- referenceImageUrl is always null (images are generated separately)
- Be specific and actionable in visual direction — avoid vague terms
- Respond ONLY with the JSON object`;

  const scriptDetails = scriptsOutput.scripts
    .map((script, idx) => {
      const timingDetails = script.timing
        .map((t) => `  - ${t.section} (${t.startSec}s-${t.endSec}s): ${t.content}`)
        .join("\n");

      return `**Script ${idx} (${script.format}, ${script.platform}):**
Hook: "${script.timing.find((t) => t.section === "hook")?.content ?? ""}"
Full timing:
${timingDetails}
Production notes: ${script.productionNotes}`;
    })
    .join("\n\n");

  let userMessage = `Create storyboards for these scripts:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
**Platforms:** ${brief.platforms.join(", ")}

${scriptDetails}`;

  if (brief.productImages && brief.productImages.length > 0) {
    userMessage += `\n\n**Product Images (incorporate into visual direction):**\n${brief.productImages.map((url) => `- ${url}`).join("\n")}`;
  }

  return { systemPrompt, userMessage };
}

export async function runStoryboardBuilder(
  brief: StoryboardBrief,
  scriptsOutput: ScriptWriterOutput,
  apiKey: string,
  imageGenerator?: ImageGenerator,
): Promise<StoryboardOutput> {
  const { systemPrompt, userMessage } = buildStoryboardPrompt(brief, scriptsOutput);

  const output = await callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: StoryboardOutput,
    maxTokens: 8192,
  });

  // If no image generator, return Claude output as-is (all referenceImageUrl are null)
  if (!imageGenerator) {
    return output;
  }

  // Create a deep copy to avoid mutating the original output (important for tests)
  const result: StoryboardOutput = {
    storyboards: output.storyboards.map((storyboard) => ({
      ...storyboard,
      scenes: storyboard.scenes.map((scene) => ({ ...scene })),
    })),
  };

  // Generate reference images for each scene
  for (const storyboard of result.storyboards) {
    for (const scene of storyboard.scenes) {
      try {
        const imagePrompt = `Ad scene reference image: ${scene.description}. Visual style: ${scene.visualDirection}. Product: ${brief.productDescription}. Platform: ${brief.platforms.join(", ")}.`;
        scene.referenceImageUrl = await imageGenerator.generate(imagePrompt);
      } catch (err) {
        console.warn(
          `Image generation failed for scene ${scene.sceneNumber}: ${err instanceof Error ? err.message : String(err)}`,
        );
        scene.referenceImageUrl = null;
      }
    }
  }

  return result;
}
