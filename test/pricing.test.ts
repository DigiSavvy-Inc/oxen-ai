import { describe, expect, it } from "vitest";
import { estimateGenerationCost, parseOxenPricing } from "../worker/pricing";

describe("parseOxenPricing", () => {
  it("returns null for empty or unknown objects", () => {
    expect(parseOxenPricing(null)).toBeNull();
    expect(parseOxenPricing({})).toBeNull();
    expect(parseOxenPricing({ unknown: 1 })).toBeNull();
  });

  it("keeps known pricing fields", () => {
    expect(
      parseOxenPricing({
        method: "per_video_output_second",
        cost_per_second: "0.08",
        cost_per_second_with_audio: 0.1,
        cost_per_second_high_res: 0.12,
      }),
    ).toEqual({
      method: "per_video_output_second",
      cost_per_image: null,
      cost_per_image_grid: null,
      cost_per_second: 0.08,
      cost_per_second_by_resolution: null,
      cost_per_second_with_audio: 0.1,
      cost_per_second_high_res: 0.12,
    });
  });

  it("keeps Oxen image grids and per-resolution video rates", () => {
    expect(
      parseOxenPricing({
        method: "per_image",
        cost_per_image: null,
        cost_per_image_grid: {
          high: { "1K": 0.13, "2K": 0.29, "4K": 1.13 },
          low: { "1K": 0.004, "2K": 0.009, "4K": 0.035 },
        },
      }),
    ).toMatchObject({
      method: "per_image",
      cost_per_image: null,
      cost_per_image_grid: {
        high: { "1K": 0.13, "2K": 0.29, "4K": 1.13 },
        low: { "1K": 0.004, "2K": 0.009, "4K": 0.035 },
      },
    });
  });
});

describe("estimateGenerationCost", () => {
  it("multiplies per-image cost by num_generations", () => {
    expect(
      estimateGenerationCost({
        pricing: { method: "per_image", cost_per_image: 0.02 },
        numGenerations: 3,
      }),
    ).toEqual({ amount: 0.06, label: "≈$0.060" });
  });

  it("uses audio and high-res per-second rates for video", () => {
    expect(
      estimateGenerationCost({
        pricing: {
          method: "per_video_output_second",
          cost_per_second: 0.05,
          cost_per_second_with_audio: 0.08,
          cost_per_second_high_res: 0.12,
        },
        numGenerations: 2,
        duration: 5,
        generateAudio: true,
      }),
    ).toEqual({ amount: 0.8, label: "≈$0.80" });

    expect(
      estimateGenerationCost({
        pricing: {
          method: "per_video_output_second",
          cost_per_second: 0.05,
          cost_per_second_high_res: 0.12,
        },
        numGenerations: 1,
        duration: "8",
        resolution: "1080p",
      }),
    ).toEqual({ amount: 0.96, label: "≈$0.96" });
  });

  it("uses Oxen cost_per_image_grid for quality and resolution", () => {
    const pricing = {
      method: "per_image" as const,
      cost_per_image: null,
      cost_per_image_grid: {
        high: { "1K": 0.13, "2K": 0.29, "4K": 1.13 },
        low: { "1K": 0.004, "2K": 0.009, "4K": 0.035 },
        medium: { "1K": 0.031, "2K": 0.071, "4K": 0.281 },
      },
    };
    expect(
      estimateGenerationCost({
        pricing,
        numGenerations: 1,
        quality: "high",
        resolution: "2K",
      }),
    ).toEqual({ amount: 0.29, label: "≈$0.290" });
    expect(
      estimateGenerationCost({
        pricing,
        numGenerations: 2,
        quality: "low",
        resolution: "4k",
      }).amount,
    ).toBeCloseTo(0.07);
    expect(
      estimateGenerationCost({
        pricing,
        numGenerations: 1,
        quality: "medium",
        resolution: "1K",
      }),
    ).toEqual({ amount: 0.031, label: "≈$0.031" });
  });

  it("uses cost_per_second_by_resolution for live video rates", () => {
    expect(
      estimateGenerationCost({
        pricing: {
          method: "per_video_output_second",
          cost_per_second: 0.231,
          cost_per_second_by_resolution: { "1080p": 0.569, "480p": 0.103, "720p": 0.231 },
        },
        numGenerations: 1,
        duration: 5,
        resolution: "480p",
      }),
    ).toEqual({ amount: 0.515, label: "≈$0.52" });
    expect(
      estimateGenerationCost({
        pricing: {
          method: "per_video_output_second",
          cost_per_second: 0.231,
          cost_per_second_by_resolution: { "1080p": 0.569, "480p": 0.103, "720p": 0.231 },
        },
        numGenerations: 1,
        duration: 5,
        resolution: "1080P",
      }).amount,
    ).toBeCloseTo(2.845);
  });

  it("returns unavailable when pricing is missing", () => {
    expect(estimateGenerationCost({ pricing: null, numGenerations: 1 })).toEqual({
      amount: null,
      label: "Price unavailable",
    });
  });
});
