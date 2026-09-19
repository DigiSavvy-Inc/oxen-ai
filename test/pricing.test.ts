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
      cost_per_second: 0.08,
      cost_per_second_with_audio: 0.1,
      cost_per_second_high_res: 0.12,
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

  it("returns unavailable when pricing is missing", () => {
    expect(estimateGenerationCost({ pricing: null, numGenerations: 1 })).toEqual({
      amount: null,
      label: "Price unavailable",
    });
  });
});
