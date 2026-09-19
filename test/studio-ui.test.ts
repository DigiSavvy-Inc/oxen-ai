import { describe, expect, it } from "vitest";
import {
  coverGeneration,
  groupGenerationBatches,
  isActiveGeneration,
  mergeGenerations,
} from "../src/lib/batches";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  mentionToken,
  slotRequired,
  type Generation,
} from "../src/lib/api";
import { downloadFilename, tilePreviewUrl } from "../src/lib/download";
import {
  attachmentForMention,
  cycleHotIndex,
  insertMentionToken,
  mentionAtCaret,
  mentionAtOffset,
  moveItem,
  promptHighlightParts,
  remapMentionTokens,
} from "../src/lib/mentions";
import { filterModels, generationCountForModelChange, groupPreferredModels, modelLabel } from "../src/lib/model-menu";

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

describe("mode chips", () => {
  it("labels still-to-video as Image → Video", () => {
    expect(MODE_LABELS["reference-to-video"]).toBe("Image → Video");
    expect(ALL_MODES).toContain("reference-to-video");
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

  it("highlights completed @ImageN tokens in the prompt", () => {
    const parts = promptHighlightParts("look @Image1 and @Video2 now");
    expect(parts).toEqual([
      { type: "text", value: "look " },
      {
        type: "mention",
        mention: { start: 5, end: 12, token: "@Image1", kind: "image", index: 0 },
      },
      { type: "text", value: " and " },
      {
        type: "mention",
        mention: { start: 17, end: 24, token: "@Video2", kind: "video", index: 1 },
      },
      { type: "text", value: " now" },
    ]);
    expect(mentionAtOffset("look @Image1 now", 8)?.token).toBe("@Image1");
    expect(mentionAtOffset("look @Image1 now", 4)).toBeNull();
  });

  it("cycles the mention highlight through the attachment list", () => {
    expect(cycleHotIndex(null, 1, 3)).toBe(0);
    expect(cycleHotIndex(0, 1, 3)).toBe(1);
    expect(cycleHotIndex(2, 1, 3)).toBe(0);
    expect(cycleHotIndex(0, -1, 3)).toBe(2);
  });

  it("resolves a prompt mention to the matching attachment", () => {
    const items = [
      { name: "a.png", kind: "image" as const },
      { name: "b.mp4", kind: "video" as const },
      { name: "c.png", kind: "image" as const },
    ];
    expect(attachmentForMention(items, { kind: "image", index: 1 })?.name).toBe("c.png");
    expect(attachmentForMention(items, { kind: "video", index: 0 })?.name).toBe("b.mp4");
    expect(attachmentForMention(items, { kind: "audio", index: 0 })).toBeNull();
  });

  it("does not require optional Seedance video refs just because the mode is Video → Video", () => {
    const seedance = {
      slots: [
        { field: "input_images" as const, kind: "image" as const, required: false, maxItems: 30, asArray: true },
        { field: "input_videos" as const, kind: "video" as const, required: false, maxItems: 10, asArray: true },
      ],
    };
    expect(slotRequired(seedance, "video", "video-to-video")).toBe(false);
    expect(slotRequired(seedance, "image", "reference-to-video")).toBe(false);
    expect(slotRequired(null, "video", "video-to-video")).toBe(true);
  });

  it("reorders attachments and rewrites @ImageN tokens to match", () => {
    const a = { name: "a.png", kind: "image" as const };
    const b = { name: "b.png", kind: "image" as const };
    const c = { name: "c.png", kind: "image" as const };
    const next = moveItem([a, b, c], 2, 0);
    expect(next).toEqual([c, a, b]);
    expect(remapMentionTokens("hero @Image1 with @Image3", [a, b, c], next)).toBe(
      "hero @Image2 with @Image1",
    );
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

  it("uses compact thumbs for image tiles instead of full results", () => {
    expect(
      tilePreviewUrl(
        gen({ id: "a", mediaType: "image", resultUrl: "full.png", thumbUrl: "tiny.avif" }),
      ),
    ).toBe("tiny.avif");
    expect(tilePreviewUrl(gen({ id: "b", mediaType: "image", resultUrl: "full.png" }))).toBeNull();
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

  it("resets variation count to 1x when the selected model changes", () => {
    expect(generationCountForModelChange("flux", "kling", 4)).toBe(1);
    expect(generationCountForModelChange("flux", "flux", 3)).toBe(3);
    expect(generationCountForModelChange("", "flux", 4)).toBe(4);
  });
});
