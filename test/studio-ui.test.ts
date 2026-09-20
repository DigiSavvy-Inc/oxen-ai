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
import { formatAudioClock, shortenFileName } from "../src/lib/files";
import {
  appendAttachMention,
  DEFAULT_ATTACH_MAX,
  kindFromMediaType,
  libraryRefFromGeneration,
  mediaKindCap,
  mergeLibraryRefs,
} from "../src/lib/library-refs";
import {
  attachmentForMention,
  cycleHotIndex,
  deleteMentionToken,
  filterMentionItems,
  indexAfterInsertBefore,
  insertMentionToken,
  mentionAtCaret,
  mentionAtOffset,
  moveItem,
  promptHighlightParts,
} from "../src/lib/mentions";
import { filterModels, generationCountForModelChange, groupPreferredModels, modelLabel, pickModel } from "../src/lib/model-menu";

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
    expect(mentionAtCaret("look @Image4", 12)).toEqual({ start: 5, query: "image4" });
    expect(mentionAtCaret("look @Image4 more", 12)).toEqual({ start: 5, query: "image4" });
    expect(mentionAtCaret("look @Image4 more", 13)).toBeNull();
  });

  it("inserts the token and moves the caret past it", () => {
    const result = insertMentionToken("look @", 6, "@Image1");
    expect(result).toEqual({ next: "look @Image1 ", caret: 13 });
    expect(mentionAtCaret(result?.next ?? "", result?.caret ?? 0)).toBeNull();
  });

  it("filters the mention picker to the numbered attachment", () => {
    const items = [
      { name: "a.png", kind: "image" as const },
      { name: "b.mp4", kind: "video" as const },
      { name: "c.png", kind: "image" as const },
      { name: "d.png", kind: "image" as const },
      { name: "e.png", kind: "image" as const },
    ];
    expect(filterMentionItems("image", items).map((item) => item.name)).toEqual([
      "a.png",
      "c.png",
      "d.png",
      "e.png",
    ]);
    expect(filterMentionItems("image4", items).map((item) => item.name)).toEqual(["e.png"]);
    expect(filterMentionItems("4", items).map((item) => item.name)).toEqual(["e.png"]);
    expect(filterMentionItems("video1", items).map((item) => item.name)).toEqual(["b.mp4"]);
    expect(filterMentionItems("image9", items)).toEqual([]);
    const picked = insertMentionToken("use @image4", 11, "@Image4");
    expect(picked).toEqual({ next: "use @Image4 ", caret: 12 });
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

  it("reorders attachments without rewriting prompt tokens", () => {
    const a = { name: "a.png", kind: "image" as const };
    const b = { name: "b.png", kind: "image" as const };
    const c = { name: "c.png", kind: "image" as const };
    expect(moveItem([a, b, c], 2, 0)).toEqual([c, a, b]);
    expect(indexAfterInsertBefore(2, 0)).toBe(0);
    expect(indexAfterInsertBefore(0, 2)).toBe(1);
    expect(indexAfterInsertBefore(1, 1)).toBe(1);
    expect(indexAfterInsertBefore(1, 2)).toBe(1);
  });

  it("lets you edit the mention number without deleting the token", () => {
    expect(deleteMentionToken("look @Image1 now", 12, "backward")).toBeNull();
    expect(deleteMentionToken("look @Image12", 13, "backward")).toBeNull();
    expect(deleteMentionToken("look @Image1 now", 11, "forward")).toBeNull();
  });

  it("still removes a completed @ImageN token when deleting the prefix", () => {
    expect(deleteMentionToken("look @Image1 now", 8, "forward")).toEqual({
      next: "look now",
      caret: 5,
    });
    expect(deleteMentionToken("look @Image1 now", 13, "backward")).toEqual({
      next: "look now",
      caret: 5,
    });
    expect(deleteMentionToken("plain text", 4, "backward")).toBeNull();
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
    expect(generationCountForModelChange("", "flux", 4)).toBe(1);
  });

  it("does not auto-select a model until a mode is chosen", () => {
    const models = [{ id: "flux" }, { id: "kling" }];
    const favorites = [{ id: "flux" }];
    expect(pickModel(models, favorites, "flux", "", false)).toBe("");
    expect(pickModel(models, favorites, "flux", "kling", false)).toBe("kling");
    expect(pickModel(models, favorites, "flux", "", true)).toBe("flux");
  });
});

describe("library refs", () => {
  it("only attaches succeeded media with a result url", () => {
    expect(kindFromMediaType("video")).toBe("video");
    expect(kindFromMediaType("chat")).toBeNull();
    expect(
      libraryRefFromGeneration(
        gen({ id: "ok", status: "succeeded", resultUrl: "https://x/a.png", thumbUrl: "t.avif" }),
      ),
    ).toMatchObject({
      generationId: "ok",
      kind: "image",
      url: "https://x/a.png",
      preview: "t.avif",
    });
    expect(
      libraryRefFromGeneration(gen({ id: "nope", status: "failed", resultUrl: "https://x/a.png" })),
    ).toBeNull();
  });

  it("dedupes library items and appends until the per-kind cap", () => {
    const a = { kind: "image" as const, generationId: "a" };
    const b = { kind: "image" as const, generationId: "b" };
    const c = { kind: "image" as const, generationId: "c" };
    expect(mergeLibraryRefs([a], [a], () => 4)).toEqual([a]);
    expect(mergeLibraryRefs([a], [b], () => 1)).toEqual([a]);
    expect(mergeLibraryRefs([a], [b], () => 2).map((item) => item.generationId)).toEqual(["a", "b"]);
    expect(mergeLibraryRefs([a], [b, c], () => 2).map((item) => item.generationId)).toEqual([
      "a",
      "b",
    ]);
    expect(mergeLibraryRefs([a], [b], () => 0)).toEqual([a]);
  });

  it("caps attach slots from the live model, with a library-first fallback", () => {
    const imageSlots = {
      slots: [{ field: "input_images" as const, kind: "image" as const, required: false, maxItems: 9, asArray: true }],
    };
    const videoOnly = {
      slots: [{ field: "input_videos" as const, kind: "video" as const, required: false, maxItems: 3, asArray: true }],
    };
    expect(mediaKindCap(null, null, "image")).toBe(DEFAULT_ATTACH_MAX);
    expect(mediaKindCap(null, null, "video")).toBe(DEFAULT_ATTACH_MAX);
    expect(mediaKindCap(null, null, "audio")).toBe(DEFAULT_ATTACH_MAX);
    expect(mediaKindCap(null, "image-to-image", "image")).toBe(DEFAULT_ATTACH_MAX);
    expect(mediaKindCap(null, "reference-to-video", "image")).toBe(DEFAULT_ATTACH_MAX);
    expect(mediaKindCap(null, "text-to-video", "image")).toBe(0);
    expect(mediaKindCap(imageSlots, "text-to-image", "image")).toBe(9);
    expect(mediaKindCap(imageSlots, "reference-to-video", "image")).toBe(9);
    expect(mediaKindCap(videoOnly, "text-to-video", "image")).toBe(0);
    expect(mediaKindCap(videoOnly, "text-to-video", "video")).toBe(3);
    expect(mediaKindCap(imageSlots, "text-to-image", "audio")).toBe(0);
  });

  it("always writes mention tokens when a library item is newly staged", () => {
    expect(appendAttachMention("", "image", 0, 1)).toBe("@Image1");
    expect(appendAttachMention("a red ox", "image", 0, 1)).toBe("a red ox @Image1");
    expect(appendAttachMention("@Image1", "image", 0, 1)).toBe("@Image1");
    expect(appendAttachMention("clip", "audio", 1, 1)).toBe("clip @Audio2");
    expect(appendAttachMention("clip", "audio", 1, 0)).toBe("clip");
  });
});

describe("attachment labels", () => {
  it("keeps short names and shortens long audio filenames", () => {
    expect(shortenFileName("voice.mp3")).toBe("voice.mp3");
    expect(shortenFileName("viewer-voice-take-two-final.mp3")).toBe("viewer-voice-take….mp3");
    expect(formatAudioClock(8.2)).toBe("8s");
    expect(formatAudioClock(null)).toBe("");
  });
});
