import { describe, expect, it } from "vitest";
import {
  coverGeneration,
  groupGenerationBatches,
  isActiveGeneration,
  mergeGenerations,
} from "../src/lib/batches";
import { estimateGenerationCost, mentionToken } from "../src/lib/api";
import type { Generation } from "../src/lib/api";
import { downloadFilename } from "../src/lib/download";
import { insertMentionToken, mentionAtCaret } from "../src/lib/mentions";
import { filterModels, groupPreferredModels, modelLabel } from "../src/lib/model-menu";

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

  it("merges newer rows without dropping in-session jobs", () => {
    const queued = gen({ id: "live", status: "queued", createdAt: 20, updatedAt: 20 });
    const archive = [
      gen({ id: "old", createdAt: 10, updatedAt: 10 }),
      gen({ id: "live", status: "succeeded", createdAt: 20, updatedAt: 30, resultUrl: "https://x" }),
    ];
    const merged = mergeGenerations([queued], archive);
    expect(merged.map((item) => item.id)).toEqual(["live", "old"]);
    expect(merged[0]?.status).toBe("succeeded");
    expect(isActiveGeneration(queued)).toBe(true);
    expect(isActiveGeneration(archive[1]!)).toBe(false);
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

describe("model menu filter", () => {
  const flux = {
    id: "black-forest-labs/flux-2-pro",
    display_name: "FLUX.2 Pro",
    description: "High quality text-to-image",
  };
  const kling = {
    id: "kling-v2",
    display_name: "Kling 2.0",
    description: "Text to video",
  };
  const seedream = { id: "seedream-4", display_name: "Seedream 4" };

  it("matches id, display name, and description", () => {
    expect(filterModels([flux, kling, seedream], "flux")).toEqual([flux]);
    expect(filterModels([flux, kling, seedream], "2.0")).toEqual([kling]);
    expect(filterModels([flux, kling, seedream], "text-to-image")).toEqual([flux]);
    expect(filterModels([flux, kling, seedream], "SEEDREAM")).toEqual([seedream]);
  });

  it("returns the full list when the query is blank", () => {
    expect(filterModels([flux, kling], "   ")).toEqual([flux, kling]);
  });

  it("keeps preferred models first after filtering", () => {
    const hits = filterModels([flux, kling, seedream], "2");
    expect(groupPreferredModels(hits, [kling])).toEqual({
      preferred: [kling],
      rest: [flux],
    });
  });

  it("falls back to the model id when no display name is set", () => {
    expect(modelLabel({ id: "gpt-image-2" })).toBe("gpt-image-2");
    expect(modelLabel(flux)).toBe("FLUX.2 Pro");
  });
});
