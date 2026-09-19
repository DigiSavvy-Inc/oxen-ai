import { describe, expect, it } from "vitest";
import { clampDuration, mapMediaUrls, parseModelControls } from "../worker/schema";
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
