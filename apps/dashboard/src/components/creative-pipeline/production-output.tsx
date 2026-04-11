"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Clip {
  sceneRef: string;
  videoUrl: string;
  duration: number;
  generatedBy: string;
}

interface AssembledVideo {
  videoUrl: string;
  thumbnailUrl: string;
  format: string;
  duration: number;
  platform: string;
  hasVoiceover: boolean;
  hasCaptions: boolean;
  hasBackgroundMusic: boolean;
}

interface ProductionError {
  stage: string;
  scene: string | null;
  tool: string;
  message: string;
}

interface ProductionData {
  tier: string;
  clips: Clip[];
  assembledVideos?: AssembledVideo[];
  voiceover?: { audioUrl: string; duration: number; captionsUrl: string };
  errors?: ProductionError[];
}

interface ProductionOutputProps {
  output: unknown;
}

function isProductionData(data: unknown): data is ProductionData {
  return (
    typeof data === "object" &&
    data !== null &&
    "tier" in data &&
    "clips" in data &&
    Array.isArray((data as ProductionData).clips)
  );
}

export function ProductionOutput({ output }: ProductionOutputProps) {
  const [showClips, setShowClips] = useState(false);

  if (!isProductionData(output)) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Production output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const { tier, clips, assembledVideos, voiceover, errors } = output;

  return (
    <div className="space-y-4">
      {/* Tier badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[11px]">
          {tier.toUpperCase()} Tier
        </Badge>
        <span className="text-[13px] text-muted-foreground">
          {clips.length} clip{clips.length !== 1 ? "s" : ""} generated
        </span>
      </div>

      {/* Errors banner */}
      {errors && errors.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-[13px] font-medium text-destructive">
              {errors.length} issue{errors.length !== 1 ? "s" : ""} during production
            </span>
          </div>
          {errors.map((err, i) => (
            <p key={i} className="text-[12px] text-muted-foreground ml-6">
              [{err.tool}] {err.scene ? `Scene ${err.scene}: ` : ""}
              {err.message}
            </p>
          ))}
        </div>
      )}

      {/* Assembled videos (Pro tier) */}
      {assembledVideos && assembledVideos.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[14px] font-medium">Assembled Videos</h4>
          {assembledVideos.map((video, i) => (
            <div key={i} className="rounded-lg border border-border overflow-hidden">
              <video
                src={video.videoUrl}
                poster={video.thumbnailUrl}
                controls
                className="w-full max-h-[400px] bg-black"
              />
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {video.platform}
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {video.format}
                  </Badge>
                  <span className="text-[12px] text-muted-foreground">{video.duration}s</span>
                  {video.hasVoiceover && (
                    <Badge variant="outline" className="text-[10px]">
                      Voiceover
                    </Badge>
                  )}
                  {video.hasCaptions && (
                    <Badge variant="outline" className="text-[10px]">
                      Captions
                    </Badge>
                  )}
                </div>
                <a href={video.videoUrl} download>
                  <Button variant="ghost" size="sm">
                    <Download className="h-3.5 w-3.5 mr-1" /> Download
                  </Button>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Voiceover audio (Pro tier) */}
      {voiceover && (
        <div>
          <h4 className="text-[14px] font-medium mb-2">Voiceover</h4>
          <audio src={voiceover.audioUrl} controls className="w-full" />
          <p className="text-[12px] text-muted-foreground mt-1">{voiceover.duration}s</p>
        </div>
      )}

      {/* Individual clips (expandable) */}
      {clips.length > 0 && (
        <div>
          <button
            onClick={() => setShowClips(!showClips)}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showClips ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {assembledVideos?.length ? "Individual Clips" : "Video Clips"} ({clips.length})
          </button>
          {(showClips || !assembledVideos?.length) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {clips.map((clip, i) => (
                <div key={i} className="rounded-lg border border-border overflow-hidden">
                  <video src={clip.videoUrl} controls className="w-full max-h-[200px] bg-black" />
                  <div className="p-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] text-muted-foreground">{clip.sceneRef}</span>
                      <span className="text-[11px] text-muted-foreground">{clip.duration}s</span>
                    </div>
                    <a href={clip.videoUrl} download>
                      <Button variant="ghost" size="sm" className="h-7 px-2">
                        <Download className="h-3 w-3" />
                      </Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
