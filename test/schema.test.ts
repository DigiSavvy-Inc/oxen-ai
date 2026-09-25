import { describe, expect, it } from "vitest";
import {
  clampDuration,
  mapMediaUrls,
  parseGenerationListScope,
  lastFrameEnqueuePatch,
  parseModelControls,
  preferredAspectRatio,
  resolveEnqueueAspectRatio,
  resolutionPayloadFields,
  showGetLastFrame,
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

  it("splits Seedance character refs onto the face fields and keeps scene refs generic", () => {
    const model: OxenModel = {
      id: "bytedance-seedance-2-0-fast-reference-to-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_face_images: { type: "array", maxItems: 9, items: { type: "string" } },
          input_images: { type: "array", maxItems: 9, items: { type: "string" } },
          input_face_videos: { type: "array", maxItems: 3, items: { type: "string" } },
          input_videos: { type: "array", maxItems: 3, items: { type: "string" } },
        },
      },
    };
    const controls = parseModelControls(model);
    expect(
      mapMediaUrls(
        controls.slots,
        {
          image: ["https://scene", "https://hero", "https://room"],
          video: ["https://walk", "https://plate"],
          audio: [],
        },
        {
          image: ["scene", "character", "scene"],
          video: ["character", "scene"],
        },
      ),
    ).toEqual({
      input_face_images: ["https://hero"],
      input_images: ["https://scene", "https://room"],
      input_face_videos: ["https://walk"],
      input_videos: ["https://plate"],
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

describe("get last frame", () => {
  it("uses the schema boolean that returns the last frame and ignores end-frame inputs", () => {
    const seedance = parseModelControls({
      id: "bytedance-seedance-2-5-text-to-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          return_last_frame: {
            type: "boolean",
            description: "Return the last frame of the generated video.",
          },
          tail_image_url: { type: "string", description: "Optional URL of the end-frame image." },
        },
      },
    });
    expect(seedance.lastFrameField).toBe("return_last_frame");
    expect(
      showGetLastFrame({
        modelId: seedance.modelId,
        mode: null,
        lastFrameField: seedance.lastFrameField,
      }),
    ).toBe(true);
    expect(
      lastFrameEnqueuePatch(seedance.modelId, "text-to-video", seedance, true),
    ).toEqual({ return_last_frame: true });
    expect(lastFrameEnqueuePatch(seedance.modelId, "text-to-video", seedance, false)).toEqual({});
    expect(lastFrameEnqueuePatch(seedance.modelId, "text-to-video", seedance, undefined)).toEqual(
      {},
    );
  });

  it("maps a different real boolean name on image-to-video and video-to-video models", () => {
    const kling = parseModelControls({
      id: "kling-video-v2-6-pro-image-to-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          include_last_frame: { type: "boolean", default: false },
        },
      },
    });
    expect(kling.lastFrameField).toBe("include_last_frame");
    expect(
      showGetLastFrame({
        modelId: kling.modelId,
        mode: "reference-to-video",
        lastFrameField: kling.lastFrameField,
      }),
    ).toBe(true);
    expect(
      showGetLastFrame({
        modelId: kling.modelId,
        mode: "video-to-video",
        lastFrameField: kling.lastFrameField,
      }),
    ).toBe(true);
    expect(
      lastFrameEnqueuePatch(kling.modelId, "reference-to-video", kling, true),
    ).toEqual({ include_last_frame: true });
    expect(
      showGetLastFrame({
        modelId: kling.modelId,
        mode: "text-to-image",
        lastFrameField: kling.lastFrameField,
      }),
    ).toBe(false);
    expect(lastFrameEnqueuePatch(kling.modelId, "text-to-image", kling, true)).toEqual({});
    expect(
      showGetLastFrame({
        modelId: kling.modelId,
        mode: null,
        lastFrameField: kling.lastFrameField,
      }),
    ).toBe(false);
  });

  it("hides the control when the catalog schema has no return-last-frame boolean", () => {
    const image = parseModelControls({
      id: "bytedance-seedream-5-pro",
      display_name: "Seedream 5.0 Pro",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          size: { type: "string", enum: ["2K", "3K"] },
        },
      },
    });
    expect(image.lastFrameField).toBeNull();
    expect(
      showGetLastFrame({
        modelId: image.modelId,
        displayName: "Seedream 5.0 Pro",
        mode: "text-to-image",
        lastFrameField: image.lastFrameField,
      }),
    ).toBe(false);
    const seedanceWithoutFlag = parseModelControls({
      id: "bytedance-seedance-2-5-image-to-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          tail_image_url: { type: "string" },
          tail_image_url_has_face: { type: "boolean", default: false },
        },
      },
    });
    expect(seedanceWithoutFlag.lastFrameField).toBeNull();
    expect(
      showGetLastFrame({
        modelId: seedanceWithoutFlag.modelId,
        mode: "reference-to-video",
        lastFrameField: seedanceWithoutFlag.lastFrameField,
      }),
    ).toBe(false);
  });
});

describe("composer aspect vs reference auto", () => {
  it("sends the prompt aspect even when the schema defaults to auto", () => {
    const catalog = ["auto", "21:9", "16:9", "9:16"];
    expect(preferredAspectRatio(catalog, "9:16")).toBe("9:16");
    expect(preferredAspectRatio(catalog, "auto")).toBe("16:9");
    expect(resolveEnqueueAspectRatio("9:16", catalog)).toBe("9:16");
    expect(resolveEnqueueAspectRatio(undefined, catalog)).toBe("16:9");
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
