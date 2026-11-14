import { describe, expect, it } from "vitest";
import {
  assignFrames,
  clampDuration,
  lockedResolution,
  mapMediaUrls,
  parseGenerationListScope,
  lockedAspectRatio,
  lockedDuration,
  parseModelControls,
  preferredAspectRatio,
  resolveModeration,
  resolveSafetyChecker,
  resolveSafetyTolerance,
  resolveEnqueueAspectRatio,
  resolutionPayloadFields,
  showGetLastFrame,
  unsupportedReferenceMessage,
} from "../worker/schema";
import type { OxenModel } from "../worker/oxen";
import { flux3VideoModel } from "../worker/flux-video";
import { seedAudioModel } from "../worker/seed-audio";

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
    expect(controls.referenceTask).toBeNull();
    expect(controls.aspectLock).toBeNull();
    expect(controls.durationLock).toBeNull();
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

  it("keeps a singular image field as one URI", () => {
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
      maxItems: 1,
      asArray: false,
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

  it("reads Seedance extend, edit locks, and background or object refs", () => {
    const controls = parseModelControls({
      id: "bytedance-seedance-2-5-reference-to-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          omni_reference_task_type: {
            type: "string",
            enum: ["auto", "edit", "extend"],
            default: "auto",
          },
          aspect_ratio: {
            type: "string",
            enum: ["adaptive", "16:9", "9:16"],
            default: "adaptive",
            "x-lock": { value: "adaptive", when: { omni_reference_task_type: ["edit", "extend"] } },
          },
          duration: {
            type: ["integer", "string"],
            minimum: 4,
            maximum: 30,
            default: "auto",
            "x-lock": { value: "auto", when: { omni_reference_task_type: "edit" } },
          },
          output_format: { type: "string", enum: ["mp4", "mov"], default: "mp4" },
          input_face_images: { type: "array", maxItems: 30, items: { type: "string" } },
          input_images: { type: "array", maxItems: 30, items: { type: "string" } },
        },
      },
    });
    expect(controls.referenceTask).toEqual(["auto", "edit", "extend"]);
    expect(controls.aspectLock).toEqual({ value: "adaptive", tasks: ["edit", "extend"] });
    expect(controls.durationLock).toEqual({ value: "auto", tasks: ["edit"] });
    expect(lockedAspectRatio(controls.aspectLock, "extend", "16:9", controls.aspectRatios)).toBe(
      "adaptive",
    );
    expect(lockedAspectRatio(controls.aspectLock, "auto", "16:9", controls.aspectRatios)).toBe("16:9");
    expect(controls.duration?.kind).toBe("enum");
    if (controls.duration?.kind === "enum") {
      expect(controls.duration.values[0]).toBe("auto");
      expect(controls.duration.defaultValue).toBe("auto");
      expect(controls.duration.values).toContain("8");
    }
    expect(lockedDuration(controls.durationLock, "edit", controls.duration, 8)).toBe("auto");
    expect(lockedDuration(controls.durationLock, "extend", controls.duration, 8)).toBe("8");
    expect(
      mapMediaUrls(
        controls.slots,
        { image: ["https://room", "https://hero", "https://vase"], video: [], audio: [] },
        { image: ["background", "character", "object"] },
      ),
    ).toEqual({
      input_face_images: ["https://hero"],
      input_images: ["https://room", "https://vase"],
    });
  });

  it("keeps Seedance image-to-video start frame a string and locks draft resolution", () => {
    const controls = parseModelControls({
      id: "bytedance-seedance-2-5-image-to-video",
      description:
        "Optional end-frame control. The output keeps the aspect ratio of the first-frame image.",
      request_schema: {
        type: "object",
        required: ["prompt", "input_image"],
        properties: {
          prompt: { type: "string" },
          input_image: { type: "string", format: "uri", title: "Start Frame" },
          duration: {
            type: ["integer", "string"],
            minimum: 4,
            maximum: 30,
            default: "auto",
            "x-auto-value": "auto",
          },
          resolution: {
            type: "string",
            enum: ["480p", "720p", "1080p", "4k"],
            default: "720p",
            "x-lock": { value: "480p", when: { draft: true } },
          },
          draft: { type: "boolean", default: false },
        },
      },
    });
    expect(controls.slots).toEqual([
      { field: "input_image", kind: "image", required: true, maxItems: 1, asArray: false },
    ]);
    expect(
      mapMediaUrls(controls.slots, {
        image: ["https://cdn.example/start.png"],
        video: [],
        audio: [],
      }),
    ).toEqual({ input_image: "https://cdn.example/start.png" });
    expect(controls.duration?.kind).toBe("enum");
    if (controls.duration?.kind === "enum") expect(controls.duration.defaultValue).toBe("auto");
    expect(controls.resolutionDraftLock).toBe("480p");
    expect(lockedResolution(true, controls.resolutionDraftLock, "720p")).toBe("480p");
    expect(lockedResolution(false, controls.resolutionDraftLock, "720p")).toBe("720p");
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
  it("shows the control for Seedance and for image-to-video or video-to-video", () => {
    expect(
      showGetLastFrame({
        modelId: "bytedance-seedance-2-5-text-to-video",
        displayName: "Seedance 2.5",
        mode: null,
      }),
    ).toBe(true);
    expect(
      showGetLastFrame({
        modelId: "kling-video-v2-6-pro-image-to-video",
        mode: "reference-to-video",
      }),
    ).toBe(true);
    expect(
      showGetLastFrame({
        modelId: "kling-video-o3-pro-video-to-video-edit",
        mode: "video-to-video",
      }),
    ).toBe(true);
    expect(
      showGetLastFrame({
        modelId: "bytedance-seedream-5-pro",
        displayName: "Seedream 5.0 Pro",
        mode: "text-to-image",
      }),
    ).toBe(false);
    expect(
      showGetLastFrame({
        modelId: "kling-video-v2-6-pro",
        mode: "text-to-video",
      }),
    ).toBe(false);
    expect(showGetLastFrame({ modelId: "", mode: null })).toBe(false);
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
  it("keeps compatible enum values and snaps others to the nearest allowed", () => {
    const duration = {
      kind: "enum" as const,
      values: ["auto", "4", "5", "8"],
      defaultValue: "auto",
    };
    expect(clampDuration("8", duration)).toBe("8");
    expect(clampDuration(5, duration)).toBe("5");
    expect(clampDuration("99", duration)).toBe("8");
  });

  it("clamps integer durations", () => {
    const duration = { kind: "int" as const, min: 3, max: 15, defaultValue: 5 };
    expect(clampDuration(8, duration)).toBe(8);
    expect(clampDuration(1, duration)).toBe(3);
    expect(clampDuration("auto", duration)).toBe(5);
  });
});

describe("Seed Audio 1.0 controls", () => {
  it("reads the live catalog slots and does not require a reference", () => {
    const controls = parseModelControls(seedAudioModel);
    expect(controls.modelId).toBe("bytedance-seed-audio-1-0");
    expect(controls.slots).toEqual([
      {
        field: "audio_urls",
        kind: "audio",
        required: false,
        maxItems: 3,
        asArray: true,
      },
      {
        field: "image_url",
        kind: "image",
        required: false,
        maxItems: 1,
        asArray: false,
      },
    ]);
    expect(controls.outputFormat?.[0]).toBe("mp3");
    expect(controls.sampleRate).toMatchObject({ kind: "enum", defaultValue: "24000" });
    expect(controls.speed).toMatchObject({ kind: "int", min: 0.5, max: 2, step: 0.1, defaultValue: 1 });
    expect(controls.volume).toMatchObject({ kind: "int", min: 0.5, max: 2, defaultValue: 1 });
    expect(controls.pitch).toMatchObject({ kind: "int", min: -12, max: 12, defaultValue: 0 });
    expect(controls.imageAudioExclusive).toBe(true);
    expect(controls.mentionKinds).toEqual(["audio"]);
    expect(controls.aspectRatios).toBeNull();
    expect(controls.seed).toBe(false);
    expect(
      mapMediaUrls(controls.slots, {
        image: [],
        video: [],
        audio: ["https://studio.example/a.mp3", "https://studio.example/b.mp3"],
      }),
    ).toEqual({
      audio_urls: ["https://studio.example/a.mp3", "https://studio.example/b.mp3"],
    });
  });

  it("rejects video for Seed Audio and rejects a non-audio file for an audio-only model", () => {
    const seed = parseModelControls(seedAudioModel);
    expect(
      unsupportedReferenceMessage(
        seed.slots,
        { image: 0, video: 1, audio: 0 },
        seed.imageAudioExclusive,
      ),
    ).toBe("This model does not accept video");
    expect(
      unsupportedReferenceMessage(
        seed.slots,
        { image: 1, video: 0, audio: 1 },
        seed.imageAudioExclusive,
      ),
    ).toMatch(/not both/);
    expect(
      unsupportedReferenceMessage(
        seed.slots,
        { image: 0, video: 0, audio: 0 },
        seed.imageAudioExclusive,
      ),
    ).toBeNull();

    const audioOnly = parseModelControls({
      id: "audio-only",
      capabilities: { input: ["text", "audio"], output: ["audio"] },
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_audios: { type: "array", maxItems: 1, items: { type: "string" } },
        },
      },
    });
    expect(audioOnly.slots.map((slot) => slot.kind)).toEqual(["audio"]);
    expect(
      unsupportedReferenceMessage(
        audioOnly.slots,
        { image: 1, video: 0, audio: 0 },
        false,
      ),
    ).toBe("This model does not accept images");
  });
});

function fluxSafetySchema(max: number, description = "Safety filter strictness, 0 is strictest.") {
  const values: number[] = [];
  for (let n = 0; n <= max; n += 1) values.push(n);
  return {
    type: "object",
    properties: {
      prompt: { type: "string" },
      safety_tolerance: {
        type: "integer",
        enum: values,
        default: 2,
        description,
      },
    },
  };
}

describe("safety_tolerance", () => {
  it("defaults Flux schemas to the highest integer because 0 is strictest", () => {
    const image = parseModelControls({
      id: "flux-3-image",
      request_schema: fluxSafetySchema(4),
    });
    expect(image.safetyTolerance).toEqual({
      kind: "enum",
      values: ["0", "1", "2", "3", "4"],
      defaultValue: "4",
    });
    expect(image.safetyTolerance?.kind === "enum" ? image.safetyTolerance.defaultValue : "").not.toBe("2");

    const deblur = parseModelControls({
      id: "flux-deblur",
      request_schema: fluxSafetySchema(5),
    });
    expect(deblur.safetyTolerance?.kind === "enum" ? deblur.safetyTolerance.defaultValue : "").toBe("5");

    const wide = parseModelControls({
      id: "flux-1-style",
      request_schema: fluxSafetySchema(6),
    });
    expect(wide.safetyTolerance?.kind === "enum" ? wide.safetyTolerance.defaultValue : "").toBe("6");
  });

  it("reads an anyOf integer enum and a min/max range without using the schema default", () => {
    const wrapped = parseModelControls({
      id: "flux-3-video",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          safety_tolerance: {
            description: "Safety filter strictness, 0 is strictest.",
            anyOf: [
              { type: "integer", enum: [0, 1, 2, 3, 4], default: 2 },
              { type: "null" },
            ],
          },
        },
      },
    });
    expect(wrapped.safetyTolerance).toMatchObject({ kind: "enum", defaultValue: "4" });

    const ranged = parseModelControls({
      id: "flux-ranged",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          safety_tolerance: {
            type: "integer",
            minimum: 0,
            maximum: 5,
            default: 2,
            description: "Safety filter strictness, 0 is strictest.",
          },
        },
      },
    });
    expect(ranged.safetyTolerance).toMatchObject({ kind: "int", min: 0, max: 5, defaultValue: 5 });
  });

  it("picks the low end only when the schema says higher values are stricter", () => {
    const controls = parseModelControls({
      id: "custom-safety",
      request_schema: fluxSafetySchema(4, "Higher is stricter."),
    });
    expect(controls.safetyTolerance?.kind === "enum" ? controls.safetyTolerance.defaultValue : "").toBe("0");
  });

  it("omits the control when the schema has no safety_tolerance field", () => {
    const controls = parseModelControls({
      id: "gpt-image-2-5-flare",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          quality: { type: "string", enum: ["low", "high"] },
          disable_safety_checker: { type: "boolean", default: false },
        },
      },
    });
    expect(controls.safetyTolerance).toBeNull();
    expect(resolveSafetyTolerance(6, controls.safetyTolerance)).toBeUndefined();
    expect(controls.safetyChecker).toEqual({ field: "disable_safety_checker", offValue: true });
  });

  it("forwards a chosen allowed value and falls back to the most permissive value", () => {
    const controls = parseModelControls({
      id: "flux-3-image",
      request_schema: fluxSafetySchema(4),
    });
    expect(resolveSafetyTolerance(undefined, controls.safetyTolerance)).toBe(4);
    expect(resolveSafetyTolerance(1, controls.safetyTolerance)).toBe(1);
    expect(resolveSafetyTolerance(0, controls.safetyTolerance)).toBe(0);
    expect(resolveSafetyTolerance(9, controls.safetyTolerance)).toBe(4);
    expect(resolveSafetyTolerance("2", controls.safetyTolerance)).toBe(2);
  });
});

describe("safety checker and moderation", () => {
  it("reads disable_safety_checker and leaves the checker off unless asked", () => {
    const controls = parseModelControls({
      id: "flux-2-dev",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_image: { type: "array", items: { type: "string" } },
          disable_safety_checker: {
            type: "boolean",
            default: false,
            description: "Disable safety checker for generated images.",
          },
        },
      },
    });
    expect(controls.safetyChecker).toEqual({ field: "disable_safety_checker", offValue: true });
    expect(controls.moderation).toBeNull();
    expect(resolveSafetyChecker(undefined, controls.safetyChecker)).toBe(true);
    expect(resolveSafetyChecker(false, controls.safetyChecker)).toBe(false);
    expect(resolveSafetyChecker("true", controls.safetyChecker)).toBe(true);
  });

  it("reads enable_safety_checker as off when the request value is false", () => {
    const controls = parseModelControls({
      id: "ideogram-v4",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          enable_safety_checker: { type: "boolean", default: true },
        },
      },
    });
    expect(controls.safetyChecker).toEqual({ field: "enable_safety_checker", offValue: false });
    expect(resolveSafetyChecker(undefined, controls.safetyChecker)).toBe(false);
    expect(resolveSafetyChecker(true, controls.safetyChecker)).toBe(true);
  });

  it("reads moderation and defaults to the less restrictive value", () => {
    const controls = parseModelControls({
      id: "gpt-image-2-5-flare",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          moderation: {
            type: "string",
            enum: ["low", "auto"],
            default: "low",
            description:
              "Content moderation strictness. 'low' is less restrictive than 'auto'. One of: low, auto.",
          },
        },
      },
    });
    expect(controls.safetyChecker).toBeNull();
    expect(controls.moderation).toEqual({ values: ["low", "auto"], defaultValue: "low" });
    expect(resolveModeration(undefined, controls.moderation)).toBe("low");
    expect(resolveModeration("auto", controls.moderation)).toBe("auto");
    expect(resolveModeration("strict", controls.moderation)).toBe("low");
  });

  it("omits both controls when the schema has neither field", () => {
    const controls = parseModelControls({
      id: "bytedance-seedream-5-pro",
      request_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          input_image: { type: "array", items: { type: "string" } },
        },
      },
    });
    expect(controls.safetyChecker).toBeNull();
    expect(controls.moderation).toBeNull();
    expect(resolveSafetyChecker(true, controls.safetyChecker)).toBeUndefined();
    expect(resolveModeration("low", controls.moderation)).toBeUndefined();
  });
});

describe("FLUX 3 Video controls", () => {
  const controls = parseModelControls(flux3VideoModel);

  it("reads keyframes, continuation, and the documented fields from one model", () => {
    expect(controls.modelId).toBe("flux-3-video");
    expect(controls.slots).toEqual([
      {
        field: "input_image",
        kind: "image",
        required: false,
        maxItems: 10,
        asArray: true,
      },
      {
        field: "input_video",
        kind: "video",
        required: false,
        maxItems: 1,
        asArray: false,
      },
    ]);
    expect(controls.slots.some((slot) => slot.kind === "audio")).toBe(false);
    expect(controls.mentions).toBe(false);
    expect(controls.mentionKinds).toEqual([]);
    expect(controls.aspectRatios).toEqual(["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"]);
    expect(controls.resolution).toEqual(["720p", "1080p"]);
    expect(controls.duration).toEqual({ kind: "int", min: 5, max: 20, defaultValue: 5 });
    expect(controls.generateAudio).toBe(true);
    expect(controls.generateAudioDefault).toBe(true);
    expect(controls.draft).toBe(true);
    expect(controls.draftDefault).toBe(false);
    expect(controls.safetyTolerance).toEqual({
      kind: "enum",
      values: ["0", "1", "2", "3", "4"],
      defaultValue: "4",
    });
    expect(controls.imageVideoExclusive).toBe(true);
    expect(controls.seed).toBe(false);
  });

  it("maps keyframes onto input_image and a continuation onto input_video", () => {
    expect(
      mapMediaUrls(controls.slots, {
        image: ["https://frames.example/a.png", "https://frames.example/b.png"],
        video: [],
        audio: [],
      }),
    ).toEqual({
      input_image: ["https://frames.example/a.png", "https://frames.example/b.png"],
    });
    expect(
      mapMediaUrls(controls.slots, {
        image: [],
        video: ["https://frames.example/clip.mp4"],
        audio: [],
      }),
    ).toEqual({
      input_video: "https://frames.example/clip.mp4",
    });
    expect(
      unsupportedReferenceMessage(
        controls.slots,
        { image: 1, video: 1, audio: 0 },
        false,
        true,
      ),
    ).toMatch(/can’t be used together/);
    expect(
      unsupportedReferenceMessage(controls.slots, { image: 0, video: 0, audio: 1 }, false, true),
    ).toBe("This model does not accept audio");
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

describe("first and last frames", () => {
  const seedanceI2v = {
    id: "bytedance-seedance-2-5-image-to-video",
    request_schema: {
      type: "object",
      required: ["prompt", "input_image"],
      properties: {
        prompt: { type: "string" },
        input_image: { type: "string", title: "Start Frame" },
        input_image_has_face: { type: "boolean", default: false },
        tail_image_url: { type: "string", title: "End Frame" },
        tail_image_url_has_face: { type: "boolean", default: false },
      },
    },
  };
  const klingReference = {
    id: "kling-video-v4-0-reference-to-video",
    request_schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        input_image: { type: "string" },
        tail_image_url: { type: "string" },
        input_images: { type: "array", items: { type: "string" }, maxItems: 10 },
      },
    },
  };

  it("reads a frames-only model: an end frame, face flags, and no reference list", () => {
    expect(parseModelControls(seedanceI2v).frames).toEqual({
      references: false,
      firstFace: true,
      lastFace: true,
    });
  });

  it("reads a model that takes frames and references side by side", () => {
    expect(parseModelControls(klingReference).frames).toEqual({
      references: true,
      firstFace: false,
      lastFace: false,
    });
  });

  it("reports no frames when the model has no end frame", () => {
    expect(
      parseModelControls({
        id: "bytedance-seedance-2-5-reference-to-video",
        request_schema: {
          type: "object",
          properties: { input_images: { type: "array", items: { type: "string" }, maxItems: 30 } },
        },
      }).frames,
    ).toBeNull();
  });

  it("fills first then last by order on a frames-only model, so dragging swaps them", () => {
    expect(assignFrames([null, null], { references: false })).toEqual(["first", "last"]);
    expect(assignFrames([null], { references: false })).toEqual(["first"]);
    expect(assignFrames([null, null, null], { references: false })).toEqual(["first", "last", null]);
  });

  it("leaves images as references until one is marked, when the model takes references", () => {
    expect(assignFrames([null, null], { references: true })).toEqual([null, null]);
    expect(assignFrames([null, "last", "first"], { references: true })).toEqual([null, "last", "first"]);
  });

  it("gives a frame to one image only", () => {
    expect(assignFrames(["first", "first"], { references: true })).toEqual(["first", null]);
    expect(assignFrames([null, "first"], null)).toEqual([null, null]);
  });
});
