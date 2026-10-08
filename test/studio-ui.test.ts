import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flux3VideoModel } from "../worker/flux-video";
import { parseModelControls } from "../worker/schema";
import { modelSupportsMode } from "../worker/model-modes";
import { Canvas } from "../src/components/Canvas";
import { StagedStill } from "../src/components/StagedStill";
import { Composer } from "../src/components/Composer";
import { LibraryPeek } from "../src/components/LibraryPeek";
import {
  batchPreviewItems,
  coverGeneration,
  groupGenerationBatches,
  isActiveGeneration,
  mergeGenerations,
  siblingAfterRemoval,
} from "../src/lib/batches";
import { galleryExpandTransition, versionsBesidePreview } from "../src/lib/gallery-expand";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  mentionToken,
  modeHasReferenceGallery,
  slotRequired,
  type Generation,
  type ModelControls,
} from "../src/lib/api";
import { copyText } from "../src/lib/clipboard";
import { canvasWashUrl, downloadFilename, mediaAssetId, tilePreviewUrl } from "../src/lib/download";
import { formatAudioClock, partitionMediaFiles, shortenFileName } from "../src/lib/files";
import {
  acceptedMediaKinds,
  appendAttachMention,
  attachKindCap,
  DEFAULT_ATTACH_MAX,
  fileAcceptValue,
  kindFromMediaType,
  libraryRefFromGeneration,
  mediaKindCap,
  mergeLibraryRefs,
  supportedMediaNotice,
} from "../src/lib/library-refs";
import {
  attachmentForMention,
  cycleHotIndex,
  deleteMentionToken,
  filterMentionItems,
  indexAfterInsertBefore,
  insertAttachMentions,
  insertMentionToken,
  mentionAtCaret,
  mentionAtOffset,
  mentionKeyAction,
  mentionOrdered,
  placeMentionPreview,
  stepMentionHot,
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

  it("groups pre-batch rows from one enqueue and leaves a lone older item on its own", () => {
    const shared = {
      batchId: null,
      createdAt: 50,
      mode: "text-to-image",
      model: "flux",
      prompt: "a red ox",
      mediaType: "image",
    };
    const batches = groupGenerationBatches([
      gen({ id: "old-a", ...shared }),
      gen({ id: "old-b", ...shared }),
      gen({ id: "later", ...shared, createdAt: 80 }),
      gen({ id: "other-prompt", ...shared, prompt: "a blue ox" }),
      gen({ id: "batched", ...shared, batchId: "real-batch" }),
    ]);
    expect(batches.map((batch) => batch.items.map((item) => item.id))).toEqual([
      ["old-a", "old-b"],
      ["later"],
      ["other-prompt"],
      ["batched"],
    ]);
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

  it("inserts an attach mention at the caret and keeps surrounding whitespace", () => {
    const middle = insertAttachMentions("alpha beta", 5, ["@Image1"]);
    expect(middle).toEqual({ next: "alpha @Image1 beta", caret: "alpha @Image1 ".length });
    expect(middle.caret).not.toBe(middle.next.length);
    const broken = insertAttachMentions("hello\nworld", 5, ["@Image1"]);
    expect(broken.next).toBe("hello @Image1 \nworld");
    expect(broken.caret).toBe("hello @Image1 ".length);
    const end = insertAttachMentions("hello\n", null, ["@Image1"]);
    expect(end).toEqual({ next: "hello\n@Image1 ", caret: "hello\n@Image1 ".length });
    expect(insertAttachMentions("see @Image1", null, ["@Image1"])).toEqual({
      next: "see @Image1",
      caret: "see @Image1".length,
    });
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
    const dozen = [
      ...Array.from({ length: 12 }, (_, index) => ({ name: `img-${index + 1}.png`, kind: "image" as const })),
      ...Array.from({ length: 12 }, (_, index) => ({ name: `vid-${index + 1}.mp4`, kind: "video" as const })),
      ...Array.from({ length: 12 }, (_, index) => ({ name: `aud-${index + 1}.mp3`, kind: "audio" as const })),
    ];
    for (const n of [1, 2, 5, 12]) {
      expect(filterMentionItems(String(n), dozen).map((item) => item.name)).toEqual([
        `img-${n}.png`,
        `vid-${n}.mp4`,
        `aud-${n}.mp3`,
      ]);
      expect(filterMentionItems(`image${n}`, dozen).map((item) => item.name)).toEqual([`img-${n}.png`]);
      expect(filterMentionItems(`video${n}`, dozen).map((item) => item.name)).toEqual([`vid-${n}.mp4`]);
      expect(filterMentionItems(`audio${n}`, dozen).map((item) => item.name)).toEqual([`aud-${n}.mp3`]);
    }
    const confirmed = insertMentionToken("keep\n@5 tail", 7, "@Audio5");
    expect(confirmed).toEqual({ next: "keep\n@Audio5 tail", caret: "keep\n@Audio5 ".length });
    expect(confirmed?.caret).not.toBe(confirmed?.next.length);
    const twelfth = insertMentionToken("keep\n@12 tail", 8, "@Audio12");
    expect(twelfth).toEqual({ next: "keep\n@Audio12 tail", caret: "keep\n@Audio12 ".length });
    expect(twelfth?.next.startsWith("keep\n")).toBe(true);
    expect(twelfth?.next.endsWith(" tail")).toBe(true);
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

  it("steps from the highlighted row through image, video, and audio", () => {
    const kinds = ["image", "video", "audio"] as const;
    let hot: number | null = null;
    const visited = [kinds[0]];
    for (let step = 0; step < kinds.length - 1; step += 1) {
      hot = stepMentionHot(hot, 1, kinds.length);
      visited.push(kinds[hot]);
    }
    expect(visited).toEqual(["image", "video", "audio"]);
    expect(stepMentionHot(null, 1, 3)).toBe(1);
    expect(stepMentionHot(1, 1, 3)).toBe(2);
    expect(stepMentionHot(2, -1, 3)).toBe(1);
    expect(stepMentionHot(null, -1, 3)).toBe(2);
    expect(kinds[stepMentionHot(null, -1, 3)]).toBe("audio");

    expect(mentionKeyAction("ArrowDown")).toEqual({ type: "move", delta: 1 });
    expect(mentionKeyAction("ArrowUp")).toEqual({ type: "move", delta: -1 });
    expect(mentionKeyAction("Tab")).toEqual({ type: "move", delta: 1 });
    expect(mentionKeyAction("Tab", { shiftKey: true })).toEqual({ type: "move", delta: -1 });
    expect(mentionKeyAction("Enter")).toEqual({ type: "confirm" });
    expect(mentionKeyAction("Enter", { metaKey: true })).toBeNull();
    expect(mentionKeyAction("Enter", { ctrlKey: true })).toBeNull();
    expect(mentionKeyAction("Escape")).toEqual({ type: "close" });
    expect(mentionKeyAction("a")).toBeNull();
  });

  it("places a mention preview under the token and flips above the viewport edge", () => {
    const under = placeMentionPreview(
      { left: 120, top: 40, bottom: 58 },
      { width: 160, height: 90 },
      { width: 1000, height: 800 },
    );
    expect(under).toEqual({ left: 120, top: 64 });
    const above = placeMentionPreview(
      { left: 120, top: 740, bottom: 758 },
      { width: 160, height: 90 },
      { width: 1000, height: 800 },
    );
    expect(above).toEqual({ left: 120, top: 644 });
    expect(above.top + 90).toBeLessThanOrEqual(800 - 8);
    const shifted = placeMentionPreview(
      { left: 940, top: 40, bottom: 58 },
      { width: 160, height: 90 },
      { width: 1000, height: 800 },
    );
    expect(shifted.left).toBe(832);
    expect(shifted.top).toBe(64);
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

  it("accepts only the media kinds the selected model lists", () => {
    const seedream = { capabilities: { input: ["text", "image"] } };
    const seedance = { capabilities: { input: ["text", "image", "video", "audio"] } };
    const imageSlots = {
      slots: [{ field: "input_images" as const, kind: "image" as const, required: false, maxItems: 9, asArray: true }],
    };
    const seedanceSlots = {
      slots: [
        { field: "input_images" as const, kind: "image" as const, required: false, maxItems: 9, asArray: true },
        { field: "input_videos" as const, kind: "video" as const, required: false, maxItems: 3, asArray: true },
        { field: "input_audios" as const, kind: "audio" as const, required: false, maxItems: 3, asArray: true },
      ],
    };
    expect(attachKindCap(imageSlots, "image-to-image", "image", seedream)).toBe(9);
    expect(attachKindCap(imageSlots, "image-to-image", "video", seedream)).toBe(0);
    expect(attachKindCap(imageSlots, "image-to-image", "audio", seedream)).toBe(0);
    expect(attachKindCap(null, "image-to-image", "video", seedream)).toBe(0);
    expect(attachKindCap(null, "image-to-image", "image", seedream)).toBe(DEFAULT_ATTACH_MAX);
    expect(attachKindCap(seedanceSlots, "reference-to-video", "video", seedance)).toBe(3);
    expect(attachKindCap(seedanceSlots, "reference-to-video", "audio", seedance)).toBe(3);
    expect(attachKindCap(null, "reference-to-video", "video", seedance)).toBe(DEFAULT_ATTACH_MAX);
    expect(fileAcceptValue(acceptedMediaKinds(imageSlots, "image-to-image", seedream))).toBe("image/*");
    expect(fileAcceptValue(acceptedMediaKinds(seedanceSlots, "reference-to-video", seedance))).toBe(
      "image/*,video/*,audio/*",
    );
    expect(supportedMediaNotice(["image"])).toBe("This model accepts images.");
    expect(modeHasReferenceGallery("image-to-image")).toBe(true);
    expect(modeHasReferenceGallery("text-to-image")).toBe(false);
    expect(modeHasReferenceGallery("reference-to-video")).toBe(true);
    const image = new File(["x"], "still.png", { type: "image/png" });
    const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const split = partitionMediaFiles([image, video], ["image"]);
    expect(split.accepted.map((item) => item.kind)).toEqual(["image"]);
    expect(split.rejected.map((file) => file.name)).toEqual(["clip.mp4"]);
  });

  it("rejects a non-audio upload when the model only accepts audio", () => {
    const audioOnly = { capabilities: { input: ["text", "audio"] } };
    const slots = {
      slots: [
        { field: "input_audios" as const, kind: "audio" as const, required: false, maxItems: 3, asArray: true },
      ],
    };
    expect(attachKindCap(slots, "text-to-audio", "audio", audioOnly)).toBe(3);
    expect(attachKindCap(slots, "text-to-audio", "image", audioOnly)).toBe(0);
    expect(attachKindCap(slots, "text-to-audio", "video", audioOnly)).toBe(0);
    expect(fileAcceptValue(acceptedMediaKinds(slots, "text-to-audio", audioOnly))).toBe("audio/*");
    const image = new File(["x"], "still.png", { type: "image/png" });
    const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const audio = new File(["x"], "voice.mp3", { type: "audio/mpeg" });
    const split = partitionMediaFiles(
      [image, video, audio],
      acceptedMediaKinds(slots, "text-to-audio", audioOnly),
    );
    expect(split.accepted.map((item) => item.file.name)).toEqual(["voice.mp3"]);
    expect(split.rejected.map((file) => file.name)).toEqual(["still.png", "clip.mp4"]);
  });

  it("lets Seed Audio take a prompt with optional audio or image, and rejects video", () => {
    const seed = {
      capabilities: { input: ["text", "audio", "image"], output: ["audio"] },
    };
    const slots = {
      slots: [
        { field: "audio_urls" as const, kind: "audio" as const, required: false, maxItems: 3, asArray: true },
        { field: "image_url" as const, kind: "image" as const, required: false, maxItems: 1, asArray: false },
      ],
    };
    expect(attachKindCap(slots, "text-to-audio", "audio", seed)).toBe(3);
    expect(attachKindCap(slots, "text-to-audio", "image", seed)).toBe(1);
    expect(attachKindCap(slots, "text-to-audio", "video", seed)).toBe(0);
    expect(slotRequired(slots, "audio", "text-to-audio")).toBe(false);
    expect(slotRequired(slots, "image", "text-to-audio")).toBe(false);
    const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const split = partitionMediaFiles([video], acceptedMediaKinds(slots, "text-to-audio", seed));
    expect(split.accepted).toEqual([]);
    expect(split.rejected.map((file) => file.name)).toEqual(["clip.mp4"]);
  });

  it("always writes mention tokens when a library item is newly staged", () => {
    expect(appendAttachMention("", "image", 0, 1)).toBe("@Image1");
    expect(appendAttachMention("a red ox", "image", 0, 1)).toBe("a red ox @Image1");
    expect(appendAttachMention("@Image1", "image", 0, 1)).toBe("@Image1");
    expect(appendAttachMention("clip", "audio", 1, 1)).toBe("clip @Audio2");
    expect(appendAttachMention("clip", "audio", 1, 0)).toBe("clip");
  });
});

describe("in-gallery version expand", () => {
  const closed = { expandedId: null, previewId: null, fitOpen: false };

  it("expands one multi-version set in place and leaves the attach peek closed", () => {
    const opened = galleryExpandTransition(closed, {
      type: "tile",
      batchId: "set",
      count: 3,
      openId: "a",
    });
    expect(opened).toMatchObject({ expandedId: "set", previewId: "a", fitOpen: false, peek: null });
    const collapsed = galleryExpandTransition(opened, {
      type: "tile",
      batchId: "set",
      count: 3,
      openId: "a",
    });
    expect(collapsed).toMatchObject({ expandedId: null, fitOpen: false, peek: null });
    const other = galleryExpandTransition(opened, {
      type: "tile",
      batchId: "other",
      count: 2,
      openId: "d",
    });
    expect(other).toMatchObject({ expandedId: "other", previewId: "d", peek: null });
  });

  it("expands a video in the gallery even when it is the only version", () => {
    const opened = galleryExpandTransition(closed, {
      type: "tile",
      batchId: "clip",
      count: 1,
      openId: "v1",
      mediaType: "video",
    });
    expect(opened).toMatchObject({ expandedId: "clip", previewId: "v1", fitOpen: false, peek: null });
    const collapsed = galleryExpandTransition(opened, {
      type: "tile",
      batchId: "clip",
      count: 1,
      openId: "v1",
      mediaType: "video",
    });
    expect(collapsed).toMatchObject({ expandedId: null, previewId: null, fitOpen: false, peek: null });
    const set = galleryExpandTransition(closed, {
      type: "tile",
      batchId: "clips",
      count: 2,
      openId: "v1",
      mediaType: "video",
    });
    expect(set).toMatchObject({ expandedId: "clips", previewId: "v1", peek: null });
  });

  it("expands a single older image in the gallery and swaps the preview without opening the peek", () => {
    const opened = galleryExpandTransition(
      { expandedId: "set", previewId: "a", fitOpen: false },
      { type: "tile", batchId: "solo", count: 1, openId: "solo-1", mediaType: "image" },
    );
    expect(opened).toMatchObject({ expandedId: "solo", previewId: "solo-1", fitOpen: false, peek: null });
    const collapsed = galleryExpandTransition(opened, {
      type: "tile",
      batchId: "solo",
      count: 1,
      openId: "solo-1",
      mediaType: "image",
    });
    expect(collapsed).toMatchObject({ expandedId: null, previewId: null, fitOpen: false, peek: null });
    const swapped = galleryExpandTransition(
      { expandedId: "set", previewId: "a", fitOpen: true },
      { type: "version", versionId: "b" },
    );
    expect(swapped).toMatchObject({ expandedId: "set", previewId: "b", fitOpen: true, peek: undefined });
    expect(versionsBesidePreview([{ id: "a" }, { id: "b" }, { id: "c" }], "b").map((item) => item.id)).toEqual([
      "a",
      "c",
    ]);
    const fitted = galleryExpandTransition(
      { expandedId: "set", previewId: "b", fitOpen: false },
      { type: "preview" },
    );
    expect(fitted.fitOpen).toBe(true);
    expect(fitted.peek).toBeUndefined();
    expect(
      galleryExpandTransition(fitted, { type: "close-fit" }),
    ).toMatchObject({ fitOpen: false, expandedId: "set", previewId: "b" });
  });

  it("renders the expand inside the library scroller, not the saved gallery drawer", () => {
    const sidebar = readFileSync(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
    const drawer = readFileSync(new URL("../src/components/GalleryDrawer.tsx", import.meta.url), "utf8");
    const peek = readFileSync(new URL("../src/components/LibraryPeek.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain('className="history"');
    expect(sidebar).toContain("history-expand-versions");
    expect(sidebar).toContain(
      'className={`history-tile${selected ? " active" : ""}${expanded ? " is-open" : ""}`}',
    );
    expect(sidebar).toContain("row.map((batch) => batchTile(batch))");
    expect(sidebar).not.toContain("expandVisible.expandedId ? null");
    expect(sidebar).not.toContain("history-expand-anchor");
    expect(sidebar).not.toContain("selected-collection");
    expect(sidebar).toContain('className="history-row-detail"');
    const detail = sidebar.slice(
      sidebar.indexOf('className="history-row-detail"'),
      sidebar.indexOf("<ExpandPrompt"),
    );
    expect(detail).not.toContain("batchTile");
    expect(detail).toContain("history-expand-frame");
    expect(detail).toContain("history-expand-versions");
    expect(detail).not.toContain("history-prompt-toggle");
    expect(sidebar).toContain("versionsBesidePreview(openBatch.items, preview.id)");
    expect(sidebar).toContain("cover?.id ?? batch.items[0]?.id ?? batch.id");
    expect(sidebar).toContain("DownloadButton");
    expect(sidebar).toContain("media-download-all");
    expect(sidebar).toContain("downloadAllMedia(readyInGroup)");
    expect(sidebar).toContain("history-expand-preview");
    expect(sidebar).toContain("View full size");
    expect(sidebar).toContain("Click to attach");
    expect(sidebar).toContain("history-prompt-toggle");
    expect(sidebar).toContain("history-prompt-row");
    expect(sidebar).toContain("history-model-pill");
    expect(sidebar).toContain("model={preview.model}");
    expect(sidebar).toContain("item.mediaType === \"video\"");
    expect(sidebar).toContain("<VideoPlayMark />");
    const tileFace = sidebar.slice(sidebar.indexOf("function TileFace"), sidebar.indexOf("function PreviewFace"));
    const imageBranch = tileFace.slice(
      tileFace.indexOf('mediaType === "image"'),
      tileFace.indexOf('mediaType === "video"'),
    );
    const videoBranch = tileFace.slice(
      tileFace.indexOf('mediaType === "video"'),
      tileFace.indexOf("isActiveGeneration"),
    );
    expect(imageBranch).not.toContain("VideoPlayMark");
    expect(videoBranch).toContain("<VideoPlayMark />");
    expect(drawer).not.toContain("history-expand");
    const media = readFileSync(new URL("../src/components/FullSizeMedia.tsx", import.meta.url), "utf8");
    expect(media).toContain("kind === \"video\"");
    expect(media).toContain("!actualSize && slides.length > 1");
    const thumbStart = peek.indexOf('className="library-peek-thumb-hit"');
    const thumb = peek.slice(thumbStart, peek.indexOf("</button>", thumbStart));
    expect(thumb).toContain("onSelectVariant(item.id)");
    expect(thumb).not.toContain("setFitOpen");
  });

  it("shows the thumbnail already on screen before the full file in the expand and the fit view", () => {
    const sidebar = readFileSync(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
    const media = readFileSync(new URL("../src/components/FullSizeMedia.tsx", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("../src/components/Canvas.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const preview = sidebar.slice(sidebar.indexOf("function PreviewFace"), sidebar.indexOf("function canOpenFit"));
    expect(preview).toContain("<StagedStill");
    expect(preview).toContain("thumb={item.thumbUrl}");
    expect(preview).toContain("full={item.resultUrl}");
    expect(preview).toContain("<StagedVideo");
    expect(preview).toContain("poster={item.thumbUrl || item.lastFrameUrl}");
    expect(sidebar).toContain("poster: item.thumbUrl || item.lastFrameUrl || null");
    expect(media).toContain("<StagedStill");
    expect(media).toContain("thumb={poster}");
    expect(media).toContain("<StagedVideo");
    expect(canvas).toContain("<StagedStill");
    expect(canvas).toContain("thumb={generation.thumbUrl}");
    expect(css).toMatch(/\.staged-still \.staged-sharp\.is-ready|\.staged-sharp\.is-ready/);
    expect(css).toMatch(/\.history-expand-preview \.staged-still \.staged-sharp\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.history-expand-preview \.staged-still \.staged-sharp\.is-ready\s*\{[^}]*opacity:\s*1/);
    const waiting = renderToStaticMarkup(
      createElement(StagedStill, { thumb: "tiny.jpg", full: "full.png", alt: "Ox" }),
    );
    expect(waiting).toContain('src="tiny.jpg"');
    expect(waiting).toContain("staged-base");
    expect(waiting).toContain('src="full.png"');
    expect(waiting).toContain("staged-sharp");
    expect(waiting).not.toContain("is-ready");
    const plain = renderToStaticMarkup(createElement(StagedStill, { full: "only.png", alt: "Ox" }));
    expect(plain).toContain('src="only.png"');
    expect(plain).not.toContain("staged-base");
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
    expect(css).toContain(".history-prompt-row");
    expect(css).toContain(".history-model-pill");
    expect(css).toMatch(/\.history-tile-media > \.history-play\s*\{[^}]*top:\s*50%/);
    expect(css).toMatch(/\.history-tile-media > \.history-play\s*\{[^}]*left:\s*50%/);
    expect(css).toMatch(/\.history-expand-preview \.history-play\s*\{[^}]*width:\s*52px/);
    expect(css).toContain(".history-version.is-current::after");
    expect(css).toContain("box-shadow: inset 0 0 0 3px var(--text)");
    expect(css).not.toMatch(/\.history-tile-square span\s*\{/);
    expect(css).not.toContain("history-tile-media.mosaic");
    expect(css).not.toMatch(/\.history\s*\{[^}]*display:\s*(flex|grid)/);
    expect(css).toMatch(/\.history\s*\{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/\.history-row-detail\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
    expect(css).toMatch(/\.history-tile\.is-open \.history-tile-square\s*\{[^}]*outline:\s*2px solid/);
    expect(css).toMatch(/\.history-tile\.is-open \.history-tile-square::after\s*\{[^}]*content:\s*none/);
    expect(css).not.toMatch(/\.history-expand-anchor/);
    expect(css).not.toMatch(/\.history-expand-set/);
    expect(css).not.toMatch(/\.history-tile\.is-open \.history-tile-square::after\s*\{[^}]*inset 0 0 0 3px/);
    expect(css).toMatch(/\.selected-collection\s*\{[^}]*padding:\s*8px/);
    expect(css).toMatch(/\.selected-collection\s*\{[^}]*background:\s*var\(--bg-active\)/);
    expect(css).not.toMatch(/\.history-tile-square\s*\{[^}]*selected-collection/);
    const drawer = readFileSync(new URL("../src/components/GalleryDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("selected-collection");
    expect(drawer).toContain("props.items.length > 0");
    expect(sidebar).not.toContain("selected-collection");
    expect(css).toMatch(/\.history-expand\s*\{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/\.history-expand-versions\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(
      /\.history-row-detail \.history-expand-frame \.media-download\s*\{[^}]*display:\s*inline-flex/,
    );
    const phone = css.slice(css.indexOf("@media (max-width: 860px)"));
    expect(phone).toMatch(
      /\.history-row-detail \.history-expand-frame \.media-download\s*\{[^}]*display:\s*inline-flex/,
    );
    expect(phone).toMatch(
      /\.history-row-detail \.history-expand-frame \.media-download\s*\{[^}]*pointer-events:\s*auto/,
    );
    expect(css).toMatch(/\.history-expand-frame \.expand-corner-tr\s*\{[^}]*left:\s*0/);
    expect(css).toMatch(/\.history-expand-frame \.expand-corner-bl\s*\{[^}]*right:\s*0/);
    expect(css).toMatch(/\.history-expand-frame \.expand-corner-bl\s*\{[^}]*border-color:\s*var\(--text\)/);
    expect(sidebar).not.toContain("history-status");
    expect(sidebar).toContain("DownloadButton");
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
    expect(app).toContain("branding.name");
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

describe("library peek variations", () => {
  it("swaps the large preview from a thumbnail and leaves full size to the large image", () => {
    const peek = readFileSync(new URL("../src/components/LibraryPeek.tsx", import.meta.url), "utf8");
    const thumbStart = peek.indexOf('className="library-peek-thumb-hit"');
    const thumbEnd = peek.indexOf("</button>", thumbStart);
    const thumb = peek.slice(thumbStart, thumbEnd);
    expect(thumb).toContain("onSelectVariant(item.id)");
    expect(thumb).not.toContain("setFullSize");
    expect(thumb).not.toContain("full size");
    const hitStart = peek.indexOf('className="library-peek-hit"');
    const hit = peek.slice(hitStart, peek.indexOf("</button>", hitStart));
    expect(hit).toContain("setFitOpen(true)");
    expect(hit).not.toContain("setFullSize");
    expect(hit).toContain("<PeekStill");
    expect(peek).toContain("generation.thumbUrl");
    expect(peek).toContain("decoding={staged ? \"sync\" : \"async\"}");
    expect(peek).toContain("library-peek-sharp");
    expect(peek).toContain("Click to attach");
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.library-peek-sharp\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.library-peek-sharp\.is-ready\s*\{[^}]*opacity:\s*1/);
    const media = readFileSync(new URL("../src/components/FullSizeMedia.tsx", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("../src/components/Canvas.tsx", import.meta.url), "utf8");
    expect(media).toContain("canCycle");
    expect(media).toContain("fullsize-nav");
    expect(media).toContain("!actualSize && slides.length > 1");
    expect(canvas).toContain("slides={slides}");
    expect(peek).toContain("slides={slides}");
    expect(peek).toContain("onMouseDown={(event) => event.preventDefault()}");
  });

  it("stacks the enlarged image above the canvas and the settings palette", () => {
    const media = readFileSync(new URL("../src/components/FullSizeMedia.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(media).toContain("createPortal");
    expect(media).toContain("document.body");
    const full = Number(css.match(/\.fullsize-backdrop\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
    const modal = Number(css.match(/\.modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
    const peek = Number(css.match(/\.library-peek\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
    expect(full).toBeGreaterThan(modal);
    expect(full).toBeGreaterThan(peek);
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
  it("caps the shell, keeps the library flush left, and runs the attach peek to the right edge", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toContain("--app-max: 1440px");
    expect(css).toContain("--app-gutter:");
    expect(css).toMatch(/\.app-shell\s*\{[^}]*max-width:\s*var\(--app-max\)/);
    expect(css).toMatch(/\.sidebar\s*\{[^}]*inset:\s*0 auto 0 0/);
    expect(css).toMatch(
      /\.sidebar\s*\{[^}]*width:\s*min\(100vw,\s*calc\(var\(--app-gutter\) \+ var\(--panel-width\)\)\)/,
    );
    expect(css).toMatch(/\.sidebar\s*\{[^}]*transform:\s*translateX\(calc\(-100% - 24px\)\)/);
    expect(css).toMatch(/\.library-peek\s*\{[^}]*inset:\s*0 0 0 auto/);
    expect(css).toMatch(
      /\.library-peek\s*\{[^}]*width:\s*min\(100vw,\s*calc\(var\(--app-gutter\) \+ var\(--panel-width\)\)\)/,
    );
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

describe("get last frame control", () => {
  const base = {
    onModeChange: () => undefined,
    preferred: [],
    onModelChange: () => undefined,
    modelQuery: "",
    onModelQueryChange: () => undefined,
    isFavorite: false,
    onToggleFavorite: () => undefined,
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
    attachments: [],
    onAddFiles: () => undefined,
    onClearAttachment: () => undefined,
    onToggleAttachmentRole: () => undefined,
    onReorderAttachments: () => undefined,
    busy: false,
    error: null,
    onGenerate: () => undefined,
    canGenerate: false,
  };

  function markup(props: {
    mode: "text-to-image" | "image-to-image" | "reference-to-video" | "video-to-video" | null;
    model: string;
    showLastFrame: boolean;
    getLastFrame?: boolean;
    capabilities?: { input?: string[] };
    slots?: ModelControls["slots"];
    resolution?: string[] | null;
  }) {
    return renderToStaticMarkup(
      createElement(Composer, {
        ...base,
        mode: props.mode,
        models: [{ id: props.model, capabilities: props.capabilities }],
        model: props.model,
        controls: {
          modelId: props.model,
          aspectRatios: null,
          duration: null,
          seed: true,
          generateAudio: false,
          quality: null,
          resolution: props.resolution ?? null,
          outputFormat: null,
          background: null,
          slots: props.slots ?? [],
          mentions: (props.slots ?? []).length > 0,
          pricing: null,
        },
        showLastFrame: props.showLastFrame,
        getLastFrame: props.getLastFrame ?? false,
      }),
    );
  }

  it("is absent for text-to-image and present unchecked when the schema exposes the flag", () => {
    const still = markup({ mode: "text-to-image", model: "bytedance-seedream-5-pro", showLastFrame: false });
    expect(still).not.toContain("Get last frame");
    expect(still).not.toContain("Gallery");
    const seedance = markup({
      mode: null,
      model: "bytedance-seedance-2-5-text-to-video",
      showLastFrame: true,
    });
    expect(seedance).toContain("Get last frame");
    expect(seedance).not.toContain("Gallery");
    expect(seedance).not.toContain('checked=""');
    const video = markup({
      mode: "video-to-video",
      model: "kling-video-o3-pro-video-to-video-edit",
      showLastFrame: true,
      getLastFrame: true,
    });
    expect(video).toContain("Get last frame");
    expect(video).toContain("checked");
    expect(video).toContain("Gallery");
  });

  it("opens the gallery for image-to-image and limits uploads to images", () => {
    const still = markup({
      mode: "image-to-image",
      model: "bytedance-seedream-5-pro",
      showLastFrame: false,
      capabilities: { input: ["text", "image"] },
      resolution: ["2K", "3K"],
      slots: [
        { field: "input_images", kind: "image", required: false, maxItems: 6, asArray: true },
      ],
    });
    expect(still).toContain("Gallery");
    expect(still).toContain('accept="image/*"');
    expect(still).not.toContain("video/*");
    expect(still).not.toContain("audio/*");
    expect(still).toContain(">2K<");
    expect(still).toContain(">3K<");
  });

  it("keeps video and audio attachable on a model that accepts them", () => {
    const clip = markup({
      mode: "reference-to-video",
      model: "bytedance-seedance-2-5-reference-to-video",
      showLastFrame: false,
      capabilities: { input: ["text", "image", "video", "audio"] },
      slots: [
        { field: "input_images", kind: "image", required: false, maxItems: 9, asArray: true },
        { field: "input_videos", kind: "video", required: false, maxItems: 3, asArray: true },
        { field: "input_audios", kind: "audio", required: false, maxItems: 3, asArray: true },
      ],
    });
    expect(clip).toContain("Gallery");
    expect(clip).toContain('accept="image/*,video/*,audio/*"');
    expect(clip).not.toContain("This model needs at least one reference image.");
    expect(clip).not.toContain("This model needs a reference video.");
  });
});

describe("prompt grows downward", () => {
  it("lengthens the column instead of covering the media", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain('className="main-column"');
    expect(css).toMatch(/\.main\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.main\s*\{[^}]*overflow-anchor:\s*none/);
    expect(css).toMatch(
      /\.main-column\s*\{[^}]*grid-template-rows:\s*auto minmax\(min-content,\s*1fr\) auto/,
    );
    expect(css).toMatch(/\.main-column\s*\{[^}]*var\(--composer-grow,\s*0px\)/);
    expect(css).toMatch(/\.workspace\s*\{[^}]*min-height:\s*min-content/);
    expect(css).toMatch(/\.canvas\s*\{[^}]*min-height:\s*min-content/);
    expect(css).toMatch(/\.canvas\s*\{[^}]*overflow:\s*visible/);
    expect(composer).toContain("PROMPT_HEIGHT_BASE");
    expect(composer).toContain("--composer-grow");
    expect(composer).toContain("startHeight + (move.clientY - startY)");
  });
});

describe("mobile result stays reachable", () => {
  it("scrolls the column instead of letting a tall composer cover the output", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const phone = css.slice(css.indexOf("@media (max-width: 860px)"));
    expect(phone).toMatch(/\.main\s*\{[^}]*overflow-y:\s*auto/);
    expect(phone).toMatch(
      /\.main:has\(\.result-frame\) \.main-column\s*\{[^}]*grid-template-rows:\s*auto minmax\(min-content,\s*1fr\) auto/,
    );
    expect(phone).toMatch(
      /\.main:has\(\.result-frame\) \.workspace,\s*\.main:has\(\.result-frame\) \.canvas\s*\{[^}]*min-height:\s*min-content/,
    );
    expect(phone).toMatch(/\.attach-preview\s*\{[^}]*max-height:\s*min\(30dvh,\s*220px\)/);
    expect(phone).toMatch(/\.attach-preview\s*\{[^}]*overflow-y:\s*auto/);
    const canvas = readFileSync(new URL("../src/components/Canvas.tsx", import.meta.url), "utf8");
    expect(canvas).toContain('matchMedia("(max-width: 860px)")');
    expect(canvas).toContain("scrollIntoView");
  });
});

describe("gallery drawer", () => {
  it("is a side drawer on desktop and a full-screen sheet on a phone", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.gallery-drawer\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.gallery-drawer\s*\{[^}]*left:\s*calc\(100% \+ 12px\)/);
    expect(css).toMatch(/\.gallery-drawer\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.gallery-scroll\s*\{[^}]*overflow:\s*auto/);
    const drawer = readFileSync(new URL("../src/components/GalleryDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("New gallery");
    expect(css).toMatch(
      /@media \(max-width: 860px\) \{[\s\S]*\.gallery-drawer\.is-sheet\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0/,
    );
  });
});

describe("last frame beside the video", () => {
  const video = gen({
    id: "clip",
    mode: "reference-to-video",
    mediaType: "video",
    status: "succeeded",
    resultUrl: "https://studio.example/clip.mp4",
    lastFrameUrl: "https://studio.example/last.jpg",
    captureLastFrame: true,
  });

  it("shows the still in the main view and the library peek", () => {
    const canvas = renderToStaticMarkup(
      createElement(Canvas, {
        generation: video,
        variants: [video],
        onSelect: () => undefined,
        onTagsChange: () => undefined,
      }),
    );
    const peek = renderToStaticMarkup(
      createElement(LibraryPeek, {
        generation: video,
        variants: [video],
        attachedIds: new Set<string>(),
        attachSupported: false,
        onClose: () => undefined,
        onAttach: () => undefined,
        onSelectVariant: () => undefined,
      }),
    );
    expect(canvas).toContain("https://studio.example/clip.mp4");
    expect(canvas).toContain('alt="Last frame"');
    expect(canvas).toContain("https://studio.example/last.jpg");
    expect(peek).toContain("https://studio.example/clip.mp4");
    expect(peek).toContain('alt="Last frame"');
    expect(peek).toContain("https://studio.example/last.jpg");
    expect(libraryRefFromGeneration(video)?.url).toBe("https://studio.example/clip.mp4");
  });

  it("leaves the video alone when no last frame was stored", () => {
    const plain = { ...video, lastFrameUrl: null };
    const canvas = renderToStaticMarkup(
      createElement(Canvas, {
        generation: plain,
        variants: [plain],
        onSelect: () => undefined,
        onTagsChange: () => undefined,
      }),
    );
    expect(canvas).toContain("https://studio.example/clip.mp4");
    expect(canvas).not.toContain("Last frame");
  });
});

describe("saved prompt controls", () => {
  const promptProps = {
    mode: null,
    onModeChange: () => undefined,
    models: [],
    preferred: [],
    model: "",
    onModelChange: () => undefined,
    modelQuery: "",
    onModelQueryChange: () => undefined,
    isFavorite: false,
    onToggleFavorite: () => undefined,
    controls: null,
    prompt: "hold @Image1 still",
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
    attachments: [],
    onAddFiles: () => undefined,
    onClearAttachment: () => undefined,
    onToggleAttachmentRole: () => undefined,
    onReorderAttachments: () => undefined,
    busy: false,
    error: null,
    onGenerate: () => undefined,
    canGenerate: false,
    onSavePrompt: () => undefined,
  };

  it("hides Load prompt and Saved until this account has a saved prompt", () => {
    const empty = renderToStaticMarkup(createElement(Composer, { ...promptProps, savedPrompts: [] }));
    expect(empty).toContain("Save prompt");
    expect(empty).not.toContain("Load prompt");
    expect(empty).not.toContain("Saved");

    const filled = renderToStaticMarkup(
      createElement(Composer, {
        ...promptProps,
        savedPrompts: [{ id: "p1", name: "Hold still", body: "hold @Image1 still", createdAt: 1 }],
      }),
    );
    expect(filled).toContain("Load prompt");
    expect(filled).toContain("Save prompt");
    expect(filled).not.toContain(">Saved<");
  });
});

describe("Flux 3 Video composer", () => {
  const controls = parseModelControls(flux3VideoModel) as ModelControls;
  const fluxModel = {
    id: "flux-3-video",
    display_name: "FLUX 3 Video",
    endpoint: "/videos/generate",
    capabilities: { input: ["text", "image", "video"], output: ["video"] },
  };

  function markup(mode: "text-to-video" | "reference-to-video" | "video-to-video") {
    return renderToStaticMarkup(
      createElement(Composer, {
        mode,
        onModeChange: () => undefined,
        models: [fluxModel],
        preferred: [],
        model: fluxModel.id,
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
        duration: "5",
        onDurationChange: () => undefined,
        seed: "",
        onSeedChange: () => undefined,
        numGenerations: 1,
        onNumGenerationsChange: () => undefined,
        generateAudio: true,
        onGenerateAudioChange: () => undefined,
        draft: false,
        onDraftChange: () => undefined,
        safetyTolerance: "4",
        onSafetyToleranceChange: () => undefined,
        quality: "",
        onQualityChange: () => undefined,
        resolution: "720p",
        onResolutionChange: () => undefined,
        outputFormat: "",
        onOutputFormatChange: () => undefined,
        background: "",
        onBackgroundChange: () => undefined,
        attachments: [],
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
  }

  it("shows the documented controls and keeps keyframes off the text mode", () => {
    const text = markup("text-to-video");
    expect(text).toContain("720p");
    expect(text).toContain("1080p");
    expect(text).toContain(">auto<");
    expect(text).toContain("Audio");
    expect(text).toContain("Draft");
    expect(text).toContain('aria-label="Safety tolerance"');
    expect(text).toContain('value="4"');
    expect(text).not.toContain("audio/*");
    expect(text).not.toContain("@Audio");
    expect(text).not.toContain('accept="image/*"');
    expect(modelSupportsMode(fluxModel, "text-to-image")).toBe(false);
    expect(text).toContain("is-ghost");

    const frames = markup("reference-to-video");
    expect(frames).toContain('accept="image/*"');
    expect(frames).not.toContain("video/*");
    expect(frames).not.toContain("audio/*");
    expect(attachKindCap(controls, "reference-to-video", "image", fluxModel)).toBe(10);
    expect(attachKindCap(controls, "reference-to-video", "video", fluxModel)).toBe(0);
    expect(attachKindCap(controls, "reference-to-video", "audio", fluxModel)).toBe(0);

    const clip = markup("video-to-video");
    expect(clip).toContain('accept="video/*"');
    expect(clip).not.toContain("image/*");
    expect(attachKindCap(controls, "video-to-video", "video", fluxModel)).toBe(1);
    expect(attachKindCap(controls, "text-to-video", "image", fluxModel)).toBe(0);
    expect(attachKindCap(controls, "text-to-video", "video", fluxModel)).toBe(0);
  });
});
