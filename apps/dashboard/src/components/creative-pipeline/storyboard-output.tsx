"use client";

import { StoryboardOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

interface StoryboardOutputProps {
  output: unknown;
}

export function StoryboardOutputRenderer({ output }: StoryboardOutputProps) {
  const parsed = StoryboardOutput.safeParse(output);
  if (!parsed.success) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Unable to display formatted output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="space-y-6">
      {data.storyboards.map((sb, i) => (
        <div key={i} className="space-y-3">
          <p className="text-[13px] font-medium text-muted-foreground">
            Storyboard for script &ldquo;{sb.scriptRef}&rdquo;
          </p>
          <div className="space-y-4">
            {sb.scenes.map((scene) => (
              <SceneCard key={scene.sceneNumber} scene={scene} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface SceneProps {
  scene: {
    sceneNumber: number;
    description: string;
    visualDirection: string;
    duration: number;
    textOverlay: string | null;
    referenceImageUrl: string | null;
  };
}

function SceneCard({ scene }: SceneProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium">Scene {scene.sceneNumber}</span>
        <Badge variant="secondary" className="text-[11px]">
          {scene.duration}s
        </Badge>
      </div>
      <p className="text-[13px]">{scene.description}</p>
      <p className="text-[12px] text-muted-foreground">{scene.visualDirection}</p>
      {scene.textOverlay && (
        <div className="bg-muted/30 rounded px-3 py-2">
          <p className="text-[12px] font-medium text-muted-foreground">Text Overlay</p>
          <p className="text-[13px]">{scene.textOverlay}</p>
        </div>
      )}
      {scene.referenceImageUrl && !imageError ? (
        <img
          src={scene.referenceImageUrl}
          alt={`Scene ${scene.sceneNumber} reference`}
          className="rounded-lg max-h-64 object-cover"
          onError={() => setImageError(true)}
        />
      ) : scene.referenceImageUrl && imageError ? (
        <div className="rounded-lg bg-muted/30 h-32 flex items-center justify-center">
          <span className="text-[12px] text-muted-foreground">Image expired</span>
        </div>
      ) : (
        <div className="rounded-lg bg-muted/30 h-32 flex items-center justify-center">
          <span className="text-[12px] text-muted-foreground">No image</span>
        </div>
      )}
    </div>
  );
}
