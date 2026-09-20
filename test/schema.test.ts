import { describe, expect, it } from "vitest";
import {
  clampDuration,
  mapMediaUrls,
  parseGenerationListScope,
  parseModelControls,
  resolutionPayloadFields,
} from "../worker/schema";
import type { OxenModel } from "../worker/oxen";

describe("parseModelControls", () => {
  it("reads GPT Image 2.5 optional input_image array and shared fields", () => {
    const model: OxenModel = {
      id: "gpt-image-2-5-flare",
      request_schema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          input_image: { type: "array", maxItems: 16, items: { type: "string" } },
          aspect_ratio: { type: "string", enum: ["auto", "1:1", "16:9", "9:16"] },
          resolution: { type: "string", enum: ["1K", "2K", "4K"] },
          quality: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
          seed: { type: "integer" },
        },
      },
    };
    const controls = parseModelControls(model);
    expect(controls.slots).toEqual([
      {
        field: "input_image",
        kind: "image",
        required: false,
        maxItems: 16,
        asArray: true,
      },
    ]);
    expect(controls.aspectRatios).toContain("16:9");
    expect(controls.resolution).toEqual(["1K", "2K", "4K"]);
    expect(controls.quality).toContain("xhigh");
    expect(controls.seed).toBe(true);
    expect(controls.mentions).toBe(true);
    expect(controls.pricing).toBeNull();
    expect(
      mapMediaUrls(controls.slots, {
        image: ["https://a", "https://b"],
        video: [],
        audio: [],
      }),
    ).toEqual({
      input_image: ["https://a", "https://b"],
    });
  });

  it("keeps an explicit audio max from the schema for any model", () => {
    const controls = parseModelControls({
      id: "any-audio-model",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_audios: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    });
    expect(controls.slots).toEqual([
      {
        field: "input_audios",
        kind: "audio",
        required: false,
        maxItems: 4,
        asArray: true,
      },
    ]);
  });

  it("adds audio refs when capabilities list audio but the schema omits the field", () => {
    const controls = parseModelControls({
      id: "capable-audio-model",
      capabilities: { input: ["text", "image", "audio"], output: ["video"] },
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_images: { type: "array", maxItems: 2, items: { type: "string" } },
        },
      },
    });
    expect(controls.slots.some((slot) => slot.kind === "image")).toBe(true);
    expect(controls.slots.find((slot) => slot.kind === "audio")).toEqual({
      field: "input_audios",
      kind: "audio",
      required: false,
      maxItems: 16,
      asArray: true,
    });
    expect(controls.mentions).toBe(true);
  });

  it("raises a singular image slot when the schema mentions multiple @Image refs", () => {
    const controls = parseModelControls({
      id: "multi-still-model",
      request_schema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Reference stills with @Image1 through @Image9. Up to 9 images.",
          },
          input_image: { type: "string" },
        },
      },
    });
    expect(controls.slots.find((slot) => slot.kind === "image")).toEqual({
      field: "input_image",
      kind: "image",
      required: false,
      maxItems: 9,
      asArray: true,
    });
  });

  it("reads an audio cap from the model description", () => {
    const controls = parseModelControls({
      id: "described-audio-model",
      description: "Reference up to 10 audio clips with @Audio1",
      request_schema: { type: "object", properties: { prompt: { type: "string" } } },
    });
    expect(controls.slots.find((slot) => slot.kind === "audio")?.maxItems).toBe(10);
  });

  it("does not invent audio refs for models that do not accept them", () => {
    const controls = parseModelControls({
      id: "text-only-image",
      capabilities: { input: ["text", "image"], output: ["image"] },
      request_schema: {
        type: "object",
        properties: { prompt: { type: "string" }, input_image: { type: "string" } },
      },
    });
    expect(controls.slots.some((slot) => slot.kind === "audio")).toBe(false);
  });

  it("maps Seedance plural media fields", () => {
    const model: OxenModel = {
      id: "bytedance-seedance-2-0-reference-to-video",
      request_schema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          input_images: { type: "array", maxItems: 9, items: { type: "string" } },
          input_videos: { type: "array", maxItems: 3, items: { type: "string" } },
          input_audios: { type: "array", maxItems: 3, items: { type: "string" } },
          duration: { type: "string", enum: ["auto", "4", "5", "8", "15"], default: "auto" },
          generate_audio: { type: "boolean" },
        },
      },
    };
    const controls = parseModelControls(model);
    expect(controls.duration).toEqual({
      kind: "enum",
      values: ["auto", "4", "5", "8", "15"],
      defaultValue: "auto",
    });
    expect(controls.generateAudio).toBe(true);
    expect(controls.mentions).toBe(true);
    expect(
      mapMediaUrls(controls.slots, {
        image: ["https://a", "https://b"],
        video: ["https://v"],
        audio: [],
      }),
    ).toEqual({
      input_images: ["https://a", "https://b"],
      input_videos: ["https://v"],
    });
    expect(controls.slots.every((slot) => slot.required === false)).toBe(true);
  });

  it("prefers Seedance face image slots over generic input_images", () => {
    const model: OxenModel = {
      id: "bytedance-seedance-2-5-reference-to-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_face_images: { type: "array", maxItems: 30, items: { type: "string" } },
          input_images: { type: "array", maxItems: 30, items: { type: "string" } },
          input_face_videos: { type: "array", maxItems: 10, items: { type: "string" } },
          input_videos: { type: "array", maxItems: 10, items: { type: "string" } },
        },
      },
    };
    const controls = parseModelControls(model);
    expect(
      mapMediaUrls(controls.slots, {
        image: ["https://a", "https://b"],
        video: ["https://v"],
        audio: [],
      }),
    ).toEqual({
      input_face_images: ["https://a", "https://b"],
      input_face_videos: ["https://v"],
    });
  });

  it("sets mentions from @Image/@Video/@Audio in the prompt description", () => {
    const controls = parseModelControls({
      id: "mention-model",
      request_schema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Reference stills with @Image1 and clips with @Video1",
          },
        },
      },
    });
    expect(controls.slots).toEqual([]);
    expect(controls.mentions).toBe(true);
  });

  it("leaves mentions false when there are no slots or mention tokens", () => {
    const controls = parseModelControls({
      id: "text-only",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "A plain text prompt" },
        },
      },
    });
    expect(controls.mentions).toBe(false);
  });

  it("copies model.pricing onto controls", () => {
    const controls = parseModelControls({
      id: "priced",
      pricing: {
        method: "per_image",
        cost_per_image: 0.02,
        cost_per_second: 0.15,
      },
    });
    expect(controls.pricing).toEqual({
      method: "per_image",
      cost_per_image: 0.02,
      cost_per_image_grid: null,
      cost_per_second: 0.15,
      cost_per_second_by_resolution: null,
      cost_per_second_with_audio: null,
      cost_per_second_high_res: null,
    });
  });

  it("reads Seedream size as the resolution control and maps it to size", () => {
    const controls = parseModelControls({
      id: "bytedance-seedream-5-pro",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          size: { type: "string", enum: ["2K", "3K"] },
          aspect_ratio: { type: "string", enum: ["1:1", "16:9"] },
        },
      },
    });
    expect(controls.resolution).toEqual(["2K", "3K"]);
    expect(controls.resolutionField).toBe("size");
    expect(resolutionPayloadFields("size", "2K")).toEqual({ size: "2K" });
  });

  it("uses pricing grid resolutions when the schema omits resolution", () => {
    const controls = parseModelControls({
      id: "gpt-image-2-5-flare",
      pricing: {
        method: "per_image",
        cost_per_image_grid: {
          high: { "1K": 0.13, "2K": 0.29, "4K": 1.13 },
        },
      },
    });
    expect(controls.resolution).toEqual(["1K", "2K", "4K"]);
    expect(controls.quality).toEqual(["high"]);
    expect(controls.resolutionField).toBe("resolution");
  });
});

describe("clampDuration", () => {
  it("keeps compatible enum values and falls back otherwise", () => {
    const duration = {
      kind: "enum" as const,
      values: ["auto", "4", "5", "8"],
      defaultValue: "auto",
    };
    expect(clampDuration("8", duration)).toBe("8");
    expect(clampDuration(5, duration)).toBe("5");
    expect(clampDuration("99", duration)).toBe("auto");
  });

  it("clamps integer durations", () => {
    const duration = { kind: "int" as const, min: 3, max: 15, defaultValue: 5 };
    expect(clampDuration(8, duration)).toBe(8);
    expect(clampDuration(1, duration)).toBe(3);
    expect(clampDuration("auto", duration)).toBe(5);
  });
});

describe("parseGenerationListScope", () => {
  it("defaults missing or library to the archive list", () => {
    expect(parseGenerationListScope(undefined)).toBe("library");
    expect(parseGenerationListScope("")).toBe("library");
    expect(parseGenerationListScope("library")).toBe("library");
  });

  it("accepts active in-flight jobs and rejects unknown scopes", () => {
    expect(parseGenerationListScope("active")).toBe("active");
    expect(parseGenerationListScope("all")).toBeNull();
  });
});
