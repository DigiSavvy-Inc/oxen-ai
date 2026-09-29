import type { OxenModel } from "./oxen";

/** Live Oxen catalog id for Seed Audio 1.0 (endpoint `/audio/generate`). */
export const SEED_AUDIO_MODEL_ID = "bytedance-seed-audio-1-0";

/**
 * Snapshot of the public model detail used when the live schema cannot be loaded.
 * Generate still posts to the async queue; this is not a second endpoint.
 */
export const seedAudioModel: OxenModel = {
  id: SEED_AUDIO_MODEL_ID,
  display_name: "Seed Audio 1.0",
  description:
    "ByteDance Seed Audio 1.0 is a text-to-speech and audio generation model. It synthesizes natural speech from a text prompt with control over voice, output format, sample rate, speed, volume, and pitch. It supports voice cloning from up to three reference audio clips, or from a single reference image.",
  endpoint: "/audio/generate",
  capabilities: { input: ["text", "audio", "image"], output: ["audio"] },
  pricing: { method: "per_audio_output_second", cost_per_second: 0.003125 },
  request_schema: {
    type: "object",
    title: "Input",
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        description:
          "Prompt or text to synthesize. Reference audio inputs by order with @Audio1, @Audio2, @Audio3.",
        "x-media-references": {
          groups: [{ field: "audio_urls", pattern: "Audio {n}" }],
        },
      },
      audio_urls: {
        type: "array",
        maxItems: 3,
        nullable: true,
        description:
          "Up to 3 reference audio URLs for voice cloning (max 30s and 10MB each). Reference them in the prompt as @Audio1, @Audio2, @Audio3. Supported formats: wav, mp3, pcm, ogg_opus.",
        items: { type: "string", format: "uri" },
      },
      image_url: {
        type: "string",
        format: "uri",
        nullable: true,
        description:
          "Optional single reference image URL (jpeg, png, or webp, max 10MB). Incompatible with audio references.",
      },
      output_format: {
        type: "string",
        default: "mp3",
        enum: ["wav", "mp3", "pcm", "ogg_opus"],
        description: "Output audio file format.",
      },
      sample_rate: {
        type: "integer",
        default: 24000,
        enum: [8000, 16000, 24000, 32000, 44100, 48000],
        description: "Output sample rate in Hz.",
      },
      speed: {
        type: "number",
        default: 1,
        minimum: 0.5,
        maximum: 2,
        description: "Speech tempo multiplier (typical range 0.5-2.0).",
      },
      volume: {
        type: "number",
        default: 1,
        minimum: 0.5,
        maximum: 2,
        description: "Audio amplitude multiplier (typical range 0.5-2.0).",
      },
      pitch: {
        type: "integer",
        default: 0,
        minimum: -12,
        maximum: 12,
        description: "Pitch shift in semitones (range -12 to 12; 0 leaves the pitch unchanged).",
      },
    },
  },
};
