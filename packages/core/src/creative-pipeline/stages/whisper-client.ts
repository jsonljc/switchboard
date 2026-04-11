const OPENAI_API_BASE = "https://api.openai.com/v1";

interface WhisperConfig {
  apiKey: string;
}

interface TranscribeRequest {
  audioUrl: string;
  language?: string;
}

interface TranscribeSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscribeResult {
  srtContent: string;
  segments: TranscribeSegment[];
}

export class WhisperClient {
  private apiKey: string;

  constructor(config: WhisperConfig) {
    this.apiKey = config.apiKey;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    // Download audio file
    const audioRes = await fetch(request.audioUrl);
    if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
    const audioBlob = await audioRes.blob();

    // Send to Whisper API
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.mp3");
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");
    if (request.language) formData.append("language", request.language);

    const res = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`Whisper API: ${res.status} ${res.statusText}`);
    const data = await res.json();

    const segments: TranscribeSegment[] = (data.segments ?? []).map(
      (s: { start: number; end: number; text: string }) => ({
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      }),
    );

    return {
      srtContent: segmentsToSrt(segments),
      segments,
    };
  }
}

function segmentsToSrt(segments: TranscribeSegment[]): string {
  return segments
    .map((seg, i) => {
      const startTime = formatSrtTime(seg.start);
      const endTime = formatSrtTime(seg.end);
      return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text}\n`;
    })
    .join("\n");
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
