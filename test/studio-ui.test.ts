import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer } from "../src/components/Composer";
import {
  batchPreviewItems,
  coverGeneration,
  groupGenerationBatches,
  isActiveGeneration,
  mergeGenerations,
  siblingAfterRemoval,
} from "../src/lib/batches";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  mentionToken,
  slotRequired,
  type Generation,
  type ModelControls,
} from "../src/lib/api";
import { copyText } from "../src/lib/clipboard";
import { canvasWashUrl, downloadFilename, mediaAssetId, tilePreviewUrl } from "../src/lib/download";
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
  mentionOrdered,
  moveItem,
  tokenForItem,
  promptHighlightParts,
} from "../src/lib/mentions";
import { defaultModelChoices, filterModels, generationCountForModelChange, groupPreferredModels, modelLabel, pickModel } from "../src/lib/model-menu";
import {
  aspectCatalog,
  aspectSelectOptions,
  preferredAspectRatio,
  resolveEnqueueAspectRatio,
  takeStagedOfKind,
} from "../src/lib/params";

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

  it("keeps a remaining variation selected after deleting one", () => {
    const rows = [
      gen({ id: "a", batchId: "b1" }),
      gen({ id: "b", batchId: "b1" }),
      gen({ id: "c", batchId: "b2" }),
    ];
    expect(siblingAfterRemoval("a", new Set(["a"]), rows)).toBe("b");
    expect(siblingAfterRemoval("c", new Set(["c"]), rows)).toBeNull();
    expect(siblingAfterRemoval("a", new Set(["z"]), rows)).toBe("a");
  });

  it("puts the ready cover first in library tile previews", () => {
    const queued = gen({ id: "q", batchId: "b1", status: "queued", resultUrl: null });
    const ready = gen({
      id: "r",
      batchId: "b1",
      status: "succeeded",
      resultUrl: "https://x/a.png",
      thumbUrl: "t.avif",
    });
    const extra = gen({
      id: "e",
      batchId: "b1",
      status: "succeeded",
      resultUrl: "https://x/b.png",
    });
    expect(batchPreviewItems([queued, ready, extra]).map((item) => item.id)).toEqual(["r", "q", "e"]);
    expect(batchPreviewItems([ready]).map((item) => item.id)).toEqual(["r"]);
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

  it("keeps line breaks after an inserted image, video, or audio mention", () => {
    const prompt = "look @\nsecond line\nthird";
    const caret = 6;
    for (const token of ["@Image1", "@Video2", "@Audio3"]) {
      const result = insertMentionToken(prompt, caret, token);
      expect(result).toEqual({
        next: `look ${token} \nsecond line\nthird`,
        caret: `look ${token} `.length,
      });
      expect(mentionAtCaret(result?.next ?? "", result?.caret ?? 0)).toBeNull();
    }
  });

  it("keeps an existing space and the following lines without doubling the space", () => {
    const result = insertMentionToken("look @ more\nstill here", 6, "@Image1");
    expect(result).toEqual({
      next: "look @Image1 more\nstill here",
      caret: "look @Image1 ".length,
    });
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

  it("exposes a Seedance character or scene control on reference chips", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
    expect(app).toContain("image_roles");
    expect(app).toContain("video_roles");
    expect(app).toContain("onToggleAttachmentRole");
    expect(composer).toContain("attach-role");
    expect(composer).toContain("mentionOrdered");
    expect(composer).toContain("input_face_images");
  });

  it("numbers character chips before scene chips and hides the control without a face slot", () => {
    const controls: ModelControls = {
      modelId: "bytedance-seedance-2-0-fast-reference-to-video",
      aspectRatios: ["16:9"],
      duration: { kind: "int", min: 4, max: 15 },
      seed: false,
      generateAudio: true,
      quality: null,
      resolution: ["480p", "720p"],
      outputFormat: null,
      background: null,
      mentions: true,
      pricing: null,
      slots: [
        { field: "input_face_images", kind: "image", required: false, maxItems: 9, asArray: true },
        { field: "input_images", kind: "image", required: false, maxItems: 9, asArray: true },
        { field: "input_face_videos", kind: "video", required: false, maxItems: 3, asArray: true },
        { field: "input_videos", kind: "video", required: false, maxItems: 3, asArray: true },
        { field: "input_audios", kind: "audio", required: false, maxItems: 3, asArray: true },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(Composer, {
        mode: "reference-to-video",
        onModeChange: () => undefined,
        models: [{ id: controls.modelId, display_name: "Seedance 2.0 Fast" }],
        preferred: [],
        model: controls.modelId,
        onModelChange: () => undefined,
        modelQuery: "",
        onModelQueryChange: () => undefined,
        isFavorite: false,
        onToggleFavorite: () => undefined,
        controls,
        prompt: "",
        onPromptChange: () => undefined,
        aspectRatio: "16:9",
        onAspectRatioChange: () => undefined,
        duration: "4",
        onDurationChange: () => undefined,
        seed: "",
        onSeedChange: () => undefined,
        numGenerations: 1,
        onNumGenerationsChange: () => undefined,
        generateAudio: true,
        onGenerateAudioChange: () => undefined,
        quality: "",
        onQualityChange: () => undefined,
        resolution: "480p",
        onResolutionChange: () => undefined,
        outputFormat: "",
        onOutputFormatChange: () => undefined,
        background: "",
        onBackgroundChange: () => undefined,
        attachments: [
          { name: "room.png", preview: "data:image/gif;base64,room", kind: "image", role: "scene" },
          { name: "hero.png", preview: "data:image/gif;base64,hero", kind: "image", role: "character" },
          { name: "walk.mp4", preview: "data:video/mp4;base64,walk", kind: "video", role: "character" },
          { name: "voice.mp3", preview: "", kind: "audio" },
        ],
        onAddFiles: () => undefined,
        onClearAttachment: () => undefined,
        onToggleAttachmentRole: () => undefined,
        onReorderAttachments: () => undefined,
        busy: false,
        error: null,
        onGenerate: () => undefined,
        canGenerate: true,
      }),
    );
    const tokenBefore = (markup: string, name: string) => {
      const at = markup.indexOf(name);
      return markup.slice(Math.max(0, at - 80), at).match(/@(Image|Video|Audio)\d+/)?.[0] ?? "";
    };
    expect(html.indexOf("room.png")).toBeLessThan(html.indexOf("hero.png"));
    expect(tokenBefore(html, "room.png")).toBe("@Image2");
    expect(tokenBefore(html, "hero.png")).toBe("@Image1");
    expect(tokenBefore(html, "walk.mp4")).toBe("@Video1");
    const audioName = html.indexOf('class="attach-chip-name">voice.mp3');
    expect(html.slice(audioName - 80, audioName)).toContain("@Audio1");
    expect(html.slice(audioName, audioName + 180)).not.toContain("attach-role");
    expect(html.match(/class="attach-role"/g)?.length).toBe(2);
    expect(html.match(/class="attach-role is-scene"/g)?.length).toBe(1);

    const plain = renderToStaticMarkup(
      createElement(Composer, {
        mode: "image-to-image",
        onModeChange: () => undefined,
        models: [{ id: "flux" }],
        preferred: [],
        model: "flux",
        onModelChange: () => undefined,
        modelQuery: "",
        onModelQueryChange: () => undefined,
        isFavorite: false,
        onToggleFavorite: () => undefined,
        controls: { ...controls, modelId: "flux", slots: [
          { field: "input_images", kind: "image", required: false, maxItems: 4, asArray: true },
        ] },
        prompt: "",
        onPromptChange: () => undefined,
        aspectRatio: "1:1",
        onAspectRatioChange: () => undefined,
        duration: "",
        onDurationChange: () => undefined,
        seed: "",
        onSeedChange: () => undefined,
        numGenerations: 1,
        onNumGenerationsChange: () => undefined,
        generateAudio: false,
        onGenerateAudioChange: () => undefined,
        quality: "",
        onQualityChange: () => undefined,
        resolution: "",
        onResolutionChange: () => undefined,
        outputFormat: "",
        onOutputFormatChange: () => undefined,
        background: "",
        onBackgroundChange: () => undefined,
        attachments: [
          { name: "room.png", preview: "data:image/gif;base64,room", kind: "image", role: "scene" },
          { name: "hero.png", preview: "data:image/gif;base64,hero", kind: "image", role: "character" },
        ],
        onAddFiles: () => undefined,
        onClearAttachment: () => undefined,
        onToggleAttachmentRole: () => undefined,
        onReorderAttachments: () => undefined,
        busy: false,
        error: null,
        onGenerate: () => undefined,
        canGenerate: true,
      }),
    );
    expect(plain).not.toContain("attach-role");
    expect(plain.indexOf("room.png")).toBeLessThan(plain.indexOf("hero.png"));
    expect(tokenBefore(plain, "room.png")).toBe("@Image1");
    expect(tokenBefore(plain, "hero.png")).toBe("@Image2");
  });

  it("numbers Seedance character refs before scene refs", () => {
    const items = [
      { name: "room.png", kind: "image" as const, role: "scene" as const },
      { name: "hero.png", kind: "image" as const, role: "character" as const },
      { name: "walk.mp4", kind: "video" as const, role: "character" as const },
      { name: "plate.mp4", kind: "video" as const, role: "scene" as const },
    ];
    const ordered = mentionOrdered(items, true);
    expect(ordered.map((item) => item.name)).toEqual([
      "hero.png",
      "room.png",
      "walk.mp4",
      "plate.mp4",
    ]);
    expect(attachmentForMention(ordered, { kind: "image", index: 0 })?.name).toBe("hero.png");
    expect(attachmentForMention(ordered, { kind: "image", index: 1 })?.name).toBe("room.png");
    expect(tokenForItem(ordered, items[0]!, 0)).toBe("@Image2");
    expect(tokenForItem(ordered, items[1]!, 1)).toBe("@Image1");
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

  it("builds download filenames from prompt, media type, and a stable asset id", () => {
    const hill = gen({ id: "abc12345xxxx", prompt: "A red ox on a hill!", mediaType: "image" });
    const otherHill = gen({ id: "other-generation", prompt: "A red ox on a hill!", mediaType: "image" });
    expect(mediaAssetId(hill.id)).toMatch(/^\d{5}$/);
    expect(mediaAssetId(hill.id)).toBe(mediaAssetId("abc12345xxxx"));
    expect(mediaAssetId(hill.id)).not.toBe(mediaAssetId(otherHill.id));
    expect(downloadFilename(hill)).toBe(`ds-studio-a-red-ox-on-a-hill-${mediaAssetId(hill.id)}.png`);
    expect(downloadFilename(otherHill)).toBe(
      `ds-studio-a-red-ox-on-a-hill-${mediaAssetId(otherHill.id)}.png`,
    );
    expect(downloadFilename(hill)).not.toBe(downloadFilename(otherHill));
    expect(downloadFilename(gen({ id: "v", prompt: "clip", mediaType: "video" }))).toBe(
      `ds-studio-clip-${mediaAssetId("v")}.mp4`,
    );
  });

  it("uses compact thumbs for image tiles instead of full results", () => {
    expect(
      tilePreviewUrl(
        gen({ id: "a", mediaType: "image", resultUrl: "full.png", thumbUrl: "tiny.avif" }),
      ),
    ).toBe("tiny.avif");
    expect(tilePreviewUrl(gen({ id: "b", mediaType: "image", resultUrl: "full.png" }))).toBeNull();
  });

  it("uses a tiny thumb as the canvas wash and skips full-size files", () => {
    expect(
      canvasWashUrl(gen({ id: "a", mediaType: "image", resultUrl: "full.png", thumbUrl: "tiny.avif" })),
    ).toBe("tiny.avif");
    expect(canvasWashUrl(gen({ id: "b", mediaType: "image", resultUrl: "full.png" }))).toBeNull();
    expect(canvasWashUrl(gen({ id: "c", mediaType: "video", resultUrl: "clip.mp4" }))).toBeNull();
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

  it("lists every catalog model for a mode default, with stars first", () => {
    const catalog = [flux, kling, seedream];
    expect(defaultModelChoices(catalog, [kling], undefined)).toEqual({
      preferred: [kling],
      rest: [flux, seedream],
    });
    expect(defaultModelChoices(catalog, [], "retired-model").rest.map((item) => item.id)).toEqual([
      flux.id,
      kling.id,
      seedream.id,
      "retired-model",
    ]);
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

describe("library history layout", () => {
  it("keeps the scroller off the 3-col square grid so tiles line up", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const sidebar = readFileSync(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain('className="history"');
    expect(sidebar).toContain('className="history-grid"');
    expect(sidebar).not.toContain("history history-grid");
    expect(sidebar).toContain("history-tile-square");
    expect(css).toMatch(/\.history-grid\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\.history-tile-square\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(css).toMatch(/\.history-tile-square\s*\{[^}]*contain:\s*paint/);
    expect(css).toContain(".history-tile-square > .history-count");
    expect(css).not.toMatch(/\.history-tile-square span\s*\{/);
    expect(css).not.toContain("history-tile-media.mosaic");
    expect(css).not.toMatch(/\.history\s*\{[^}]*display:\s*(flex|grid)/);
    expect(sidebar).not.toContain("history-status");
    expect(sidebar).not.toContain("DownloadButton");
  });
});

describe("copy prompt", () => {
  it("writes prompt text to the clipboard writer", async () => {
    let written = "";
    expect(await copyText("", { writeText: async (value) => { written = value; } })).toBe(false);
    expect(written).toBe("");
    expect(await copyText("a red ox", { writeText: async (value) => { written = value; } })).toBe(true);
    expect(written).toBe("a red ox");
    expect(
      await copyText("nope", {
        writeText: async () => {
          throw new Error("denied");
        },
      }),
    ).toBe(false);
  });

  it("exposes a Delete control on the canvas and library peek", () => {
    const canvas = readFileSync(new URL("../src/components/Canvas.tsx", import.meta.url), "utf8");
    const peek = readFileSync(new URL("../src/components/LibraryPeek.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(canvas).toContain("Delete");
    expect(canvas).toContain("onDelete");
    expect(peek).toContain("Delete");
    expect(peek).toContain("MediaDeleteGroup");
    expect(peek).toContain("library-peek-thumb-hit");
    expect(peek).toContain("oxen={false}");
    expect(app).toContain("requestDeleteMedia");
    expect(app).toContain("api.deleteGeneration");
  });

  it("shows the blocks loader while library cleanup runs", () => {
    const settings = readFileSync(
      new URL("../src/components/SettingsModal.tsx", import.meta.url),
      "utf8",
    );
    const wait = readFileSync(new URL("../src/components/StatusWait.tsx", import.meta.url), "utf8");
    const loader = readFileSync(new URL("../src/components/Loader.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
    expect(settings).toContain("StatusWait");
    expect(settings).toContain("Deleting failed jobs");
    expect(settings).toContain("Building missing thumbnails");
    expect(wait).toContain("Loader");
    expect(loader).toContain("Blocks");
    expect(app).toContain("Loading DS Studio");
    expect(composer).toContain("Queuing");
  });

  it("puts a copy control next to saved prompts on the canvas and library peek", () => {
    const canvas = readFileSync(new URL("../src/components/Canvas.tsx", import.meta.url), "utf8");
    const peek = readFileSync(new URL("../src/components/LibraryPeek.tsx", import.meta.url), "utf8");
    expect(canvas).toContain("<CopyPrompt");
    expect(peek).toContain("<CopyPrompt");
    expect(peek).toContain('className="library-peek-prompt"');
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

describe("composer params across jobs and models", () => {
  it("keeps the current aspect in the select even when the catalog changed", () => {
    expect(aspectCatalog({ aspectRatios: ["16:9", "9:16"] }, "text-to-image")).toEqual([
      "16:9",
      "9:16",
    ]);
    expect(aspectCatalog(null, "text-to-video")).toEqual(["16:9", "9:16", "1:1"]);
    expect(aspectSelectOptions(["16:9", "9:16"], "1:1")).toEqual(["1:1", "16:9", "9:16"]);
    expect(aspectSelectOptions(["16:9", "9:16"], "9:16")).toEqual(["16:9", "9:16"]);
  });

  it("prefers the composer aspect over auto / reference-image matching", () => {
    const seedance = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
    expect(preferredAspectRatio(seedance, "9:16")).toBe("9:16");
    expect(preferredAspectRatio(seedance, "auto")).toBe("16:9");
    expect(preferredAspectRatio(seedance, "4:5")).toBe("16:9");
    expect(resolveEnqueueAspectRatio("9:16", seedance)).toBe("9:16");
    expect(resolveEnqueueAspectRatio("4:5", seedance)).toBe("4:5");
    expect(resolveEnqueueAspectRatio(undefined, seedance)).toBe("16:9");
    expect(resolveEnqueueAspectRatio("auto", ["auto"])).toBe("auto");
  });

  it("sends only as many staged files as the live model accepts", () => {
    const staged = [
      { kind: "image" as const, name: "a" },
      { kind: "image" as const, name: "b" },
      { kind: "video" as const, name: "c" },
    ];
    expect(takeStagedOfKind(staged, "image", 1).map((item) => item.name)).toEqual(["a"]);
    expect(takeStagedOfKind(staged, "image", 0)).toEqual([]);
    expect(takeStagedOfKind(staged, "video", 2).map((item) => item.name)).toEqual(["c"]);
  });

  it("does not drop staged media when the model or mode changes", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
    expect(app).not.toContain("mediaKindCap(controls, mode, item.kind)");
    expect(app).toContain("takeStagedOfKind");
    expect(app).toContain("hydratedParamsUserId");
    expect(app).toContain("paramsTouched");
    expect(composer).toContain("aspectSelectOptions");
    expect(composer).toContain("value={props.aspectRatio}");
    expect(app).toContain("preferredAspectRatio");
    expect(app).toContain('aspect_ratio !== "auto"');
  });
});

describe("prompt box chrome", () => {
  it("draws a light border around the prompt and arrows on the resize grip", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
    expect(css).toContain(".prompt-box");
    expect(css).toMatch(/\.prompt-box\s*\{[^}]*border:\s*1px solid var\(--border\)/);
    expect(css).toContain(".prompt-resize-arrow.is-up");
    expect(css).toContain(".prompt-resize-arrow.is-down");
    expect(composer).toContain("prompt-resize-arrow is-up");
    expect(composer).toContain("prompt-resize-arrow is-down");
  });

  it("leaves a gap between the prompt box and attached media", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.prompt-box\s*\{[^}]*margin:\s*8px 10px/);
    expect(css).toMatch(/\.attach-preview\s*\{[^}]*padding:\s*8px 10px 10px/);
  });
});

describe("thumbnail frames", () => {
  it("uses a 1px border on every side without a second ring", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.variation-thumb\s*\{[^}]*border:\s*1px solid var\(--border\)/);
    expect(css).toMatch(/\.history-tile-square\s*\{[^}]*border:\s*1px solid var\(--border\)/);
    expect(css).toMatch(/\.library-peek-thumb\s*\{[^}]*border:\s*1px solid var\(--border\)/);
    expect(css).not.toMatch(/\.variation-thumb\.active\s*\{[^}]*box-shadow/);
    expect(css).not.toMatch(/\.history-tile\.active \.history-tile-square\s*\{[^}]*box-shadow/);
    expect(css).not.toMatch(/\.library-peek-thumb\.active\s*\{[^}]*box-shadow/);
  });
});

describe("app column", () => {
  it("caps the shell and docks library panels to that column", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toContain("--app-max: 1440px");
    expect(css).toContain("--app-gutter:");
    expect(css).toMatch(/\.app-shell\s*\{[^}]*max-width:\s*var\(--app-max\)/);
    expect(css).toMatch(/\.sidebar\s*\{[^}]*inset:\s*0 auto 0 0/);
    expect(css).toMatch(
      /\.sidebar\s*\{[^}]*width:\s*min\(100vw,\s*calc\(var\(--app-gutter\) \+ var\(--panel-width\)\)\)/,
    );
    expect(css).toMatch(/\.sidebar\s*\{[^}]*transform:\s*translateX\(calc\(-100% - 24px\)\)/);
    expect(css).toMatch(/\.library-peek\s*\{[^}]*inset:\s*0 var\(--app-gutter\) 0 auto/);
    expect(css).toMatch(/\.app-shell\.has-peek \.main\s*\{[^}]*padding-right:\s*var\(--panel-width\)/);
    expect(css).not.toMatch(/\.app-shell\.library-open \.main\s*\{[^}]*padding-left:\s*var\(--panel-width\)/);
    expect(css).toMatch(/\.main-top\s*\{[^}]*width:\s*min\(920px,/);
  });
});

describe("nav shortcuts", () => {
  it("toggles the library with Command Shift L and opens settings with Command Shift comma", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const menu = readFileSync(new URL("../src/components/AccountMenu.tsx", import.meta.url), "utf8");
    expect(app).toContain('event.code === "KeyL"');
    expect(app).toContain('event.code === "Comma"');
    expect(app).toContain("Meta+Shift+L");
    expect(menu).toContain("Meta+Shift+Comma");
    expect(menu).toContain("menu-shortcut");
  });
});

describe("canvas media wash", () => {
  it("fills letterbox space with a blurred thumb or the light beige page tone", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("../src/components/Canvas.tsx", import.meta.url), "utf8");
    expect(canvas).toContain("canvasWashUrl");
    expect(canvas).toContain("result-media-wash");
    expect(css).toMatch(/\.result-media\s*\{[^}]*background:\s*var\(--bg\)/);
    expect(css).toMatch(/\.result-media-wash\s*\{[^}]*filter:\s*blur\(/);
  });
});
