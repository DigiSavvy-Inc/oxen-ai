import { describe, expect, it } from "vitest";
import { coverGeneration, groupGenerationBatches } from "../src/lib/batches";
import { estimateGenerationCost, mentionToken } from "../src/lib/api";
import type { Generation } from "../src/lib/api";
import { downloadFilename } from "../src/lib/download";
import { insertMentionToken, mentionAtCaret } from "../src/lib/mentions";

function gen(partial: Partial<Generation> & Pick<Generation, "id">): Generation {
  return {
    oxenGenerationId: partial.id,
    mode: "text-to-image",
    model: "flux",
    prompt: "ox",
    status: "succeeded",
    mediaType: "image",
    resultUrl: null,
    errorMessage: null,
    batchId: null,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("groupGenerationBatches", () => {
  it("groups variations under one batch id", () => {
    const batches = groupGenerationBatches([
      gen({ id: "a", batchId: "b1" }),
      gen({ id: "b", batchId: "b1" }),
      gen({ id: "c", batchId: "b2" }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(coverGeneration(batches[0]?.items ?? [])?.id).toBe("a");
  });
});

describe("mentions and cost", () => {
  it("uses Oxen @ImageN tokens", () => {
    expect(mentionToken("image", 0)).toBe("@Image1");
    expect(mentionToken("video", 1)).toBe("@Video2");
    expect(mentionToken("audio", 2)).toBe("@Audio3");
  });

  it("treats a typed @ as an open mention and a picked token as closed", () => {
    expect(mentionAtCaret("look @", 6)).toEqual({ start: 5, query: "" });
    expect(mentionAtCaret("look @im", 8)).toEqual({ start: 5, query: "im" });
    expect(mentionAtCaret("look @Image1", 12)).toBeNull();
    expect(mentionAtCaret("look @Image1 more", 12)).toBeNull();
  });

  it("inserts the token and moves the caret past it", () => {
    const result = insertMentionToken("look @", 6, "@Image1");
    expect(result).toEqual({ next: "look @Image1 ", caret: 13 });
    expect(mentionAtCaret(result?.next ?? "", result?.caret ?? 0)).toBeNull();
  });

  it("scales image cost by variations", () => {
    const cost = estimateGenerationCost({
      pricing: { method: "per_image", cost_per_image: 0.04 },
      numGenerations: 4,
    });
    expect(cost.amount).toBeCloseTo(0.16);
  });

  it("scales video cost by duration and count", () => {
    const cost = estimateGenerationCost({
      pricing: { method: "per_video_output_second", cost_per_second: 0.11 },
      numGenerations: 2,
      duration: "5",
    });
    expect(cost.amount).toBeCloseTo(1.1);
  });

  it("updates image price when resolution or quality changes", () => {
    const pricing = {
      method: "per_image",
      cost_per_image_grid: {
        high: { "1K": 0.13, "2K": 0.29, "4K": 1.13 },
        low: { "1K": 0.004, "2K": 0.009, "4K": 0.035 },
      },
    };
    expect(
      estimateGenerationCost({
        pricing,
        numGenerations: 1,
        quality: "high",
        resolution: "1K",
      }).amount,
    ).toBe(0.13);
    expect(
      estimateGenerationCost({
        pricing,
        numGenerations: 1,
        quality: "high",
        resolution: "4K",
      }).amount,
    ).toBe(1.13);
  });

  it("builds download filenames from prompt and media type", () => {
    expect(
      downloadFilename(
        gen({ id: "abc12345xxxx", prompt: "A red ox on a hill!", mediaType: "image" }),
      ),
    ).toBe("ds-studio-a-red-ox-on-a-hill.png");
    expect(
      downloadFilename(gen({ id: "v", prompt: "clip", mediaType: "video" }), 2),
    ).toBe("ds-studio-clip-3.mp4");
  });
});
