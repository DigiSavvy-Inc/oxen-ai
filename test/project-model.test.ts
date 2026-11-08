import { describe, expect, it } from "vitest";
import type { OxenModel } from "../worker/oxen";
import { referenceCapsFor, referenceModels, takesReferences } from "../worker/reference-models";
import type { ComposerDefaults, ComposerDraft } from "../worker/project-draft";
import { acceptComposerDefaults } from "../worker/project-draft";
import {
  composerStateForNewJob,
  composerStateOnOpen,
  defaultsAfterRun,
  pinnedDefaults,
  referenceCapsLabel,
  referenceModeFor,
  sortReferenceModels,
  unpinnedDefaults,
} from "../src/lib/project-model";

const seedance: OxenModel = {
  id: "seedance-2-5",
  display_name: "Seedance 2.5",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image", "video", "audio"], output: ["video"] },
  request_schema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string" },
      input_face_images: { type: "array", maxItems: 4, items: { type: "string" } },
      input_images: { type: "array", maxItems: 9, items: { type: "string" } },
      input_face_videos: { type: "array", maxItems: 1, items: { type: "string" } },
      input_videos: { type: "array", maxItems: 3, items: { type: "string" } },
      input_audios: { type: "array", maxItems: 3, items: { type: "string" } },
    },
  },
};

const seedream: OxenModel = {
  id: "seedream-5-0",
  display_name: "Seedream 5.0",
  endpoint: "/images/generate",
  capabilities: { input: ["text", "image"], output: ["image"] },
  request_schema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      input_image: { type: "array", maxItems: 14, items: { type: "string" } },
      resolution: { type: "string", enum: ["1K", "2K", "4K"] },
    },
  },
};

const textOnly: OxenModel = {
  id: "flux-3-pro",
  display_name: "Flux 3 Pro",
  endpoint: "/images/generate",
  capabilities: { input: ["text"], output: ["image"] },
  request_schema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      aspect_ratio: { type: "string", enum: ["1:1", "16:9"] },
    },
  },
};

const chat: OxenModel = {
  id: "gpt-5-6",
  display_name: "GPT 5.6",
  endpoint: "/chat/completions",
  capabilities: { input: ["text", "image"], output: ["text"] },
};

const noSchema: OxenModel = {
  id: "kling-3-0",
  display_name: "Kling 3.0",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image"], output: ["video"] },
};

describe("reference model filter", () => {
  it("reads caps from the request schema slots", () => {
    expect(referenceCapsFor(seedance)).toEqual({ image: 9, video: 3, audio: 3 });
    expect(referenceCapsFor(seedream)).toEqual({ image: 14, video: 0, audio: 0 });
  });

  it("drops text-only media models and chat models", () => {
    expect(referenceCapsFor(textOnly)).toBeNull();
    expect(referenceCapsFor(chat)).toBeNull();
    expect(takesReferences(null)).toBe(false);
  });

  it("falls back to the catalog's input list when a model has no schema, without a number", () => {
    expect(referenceCapsFor(noSchema)).toEqual({ image: null, video: 0, audio: 0 });
  });

  it("keeps only reference-capable models, once each, sorted by name", () => {
    const list = referenceModels([textOnly, seedream, chat, seedance, { ...seedance, id: "Seedance-2-5" }, noSchema]);
    expect(list.map((model) => model.id)).toEqual(["kling-3-0", "seedance-2-5", "seedream-5-0"]);
    expect(list[1].caps).toEqual({ image: 9, video: 3, audio: 3 });
  });

  it("labels caps in the order image, video, audio and names an unknown cap", () => {
    expect(referenceCapsLabel({ image: 9, video: 3, audio: 3 })).toBe("9 images · 3 videos · 3 audio");
    expect(referenceCapsLabel({ image: 1, video: 0, audio: 0 })).toBe("1 image");
    expect(referenceCapsLabel({ image: null, video: 0, audio: 0 })).toBe("images");
  });

  it("lists starred models first", () => {
    const list = referenceModels([seedream, seedance, noSchema]);
    expect(sortReferenceModels(list, new Set(["seedream-5-0"])).map((model) => model.id)).toEqual([
      "seedream-5-0",
      "kling-3-0",
      "seedance-2-5",
    ]);
  });

  it("picks the reference mode the model supports", () => {
    const [kling, dance, dream] = referenceModels([seedream, seedance, noSchema]);
    expect(referenceModeFor(dance)).toBe("reference-to-video");
    expect(referenceModeFor(dream)).toBe("image-to-image");
    expect(referenceModeFor(kling)).toBe("reference-to-video");
  });
});

const runSettings = { aspectRatio: "16:9", duration: "5", generateAudio: true, draft: false, safetyCheckerOn: false, getLastFrame: false };
const otherSettings = { ...runSettings, aspectRatio: "1:1" };

describe("project model defaults", () => {
  const [dance] = referenceModels([seedance]);

  it("pins the Brief's model with its reference mode and keeps settings only for the same model", () => {
    expect(pinnedDefaults(dance, null)).toEqual({ mode: "reference-to-video", model: "seedance-2-5", settings: {}, pinned: true });
    expect(pinnedDefaults(dance, { mode: "reference-to-video", model: "seedance-2-5", settings: runSettings }).settings).toBe(
      runSettings,
    );
    expect(pinnedDefaults(dance, { mode: "image-to-image", model: "seedream-5-0", settings: runSettings }).settings).toEqual({});
  });

  it("unpinning keeps the model as a plain last-run default", () => {
    expect(unpinnedDefaults({ mode: "reference-to-video", model: "seedance-2-5", settings: runSettings, pinned: true })).toEqual({
      mode: "reference-to-video",
      model: "seedance-2-5",
      settings: runSettings,
    });
    expect(unpinnedDefaults(null)).toBeNull();
  });

  it("a run replaces an unpinned default but not a pinned one", () => {
    const run: ComposerDraft = { prompt: "x", mode: "image-to-image", model: "seedream-5-0", settings: otherSettings };
    expect(defaultsAfterRun({ mode: "reference-to-video", model: "seedance-2-5", settings: runSettings }, run)).toEqual({
      mode: "image-to-image",
      model: "seedream-5-0",
      settings: otherSettings,
    });
    const pinned: ComposerDefaults = { mode: "reference-to-video", model: "seedance-2-5", settings: runSettings, pinned: true };
    expect(defaultsAfterRun(pinned, run)).toBe(pinned);
    const sameModelRun: ComposerDraft = { ...run, mode: "reference-to-video", model: "seedance-2-5" };
    expect(defaultsAfterRun(pinned, sameModelRun)).toEqual({ ...pinned, settings: otherSettings });
  });

  it("the Worker keeps the pinned flag only alongside a model", () => {
    expect(acceptComposerDefaults({ mode: "reference-to-video", model: "seedance-2-5", settings: {}, pinned: true })).toEqual({
      mode: "reference-to-video",
      model: "seedance-2-5",
      settings: {},
      pinned: true,
    });
    expect(acceptComposerDefaults({ mode: "reference-to-video", model: "", settings: {}, pinned: true })?.pinned).toBeUndefined();
    expect(acceptComposerDefaults({ mode: "reference-to-video", model: "seedance-2-5", settings: {}, pinned: "yes" })?.pinned).toBeUndefined();
  });
});

describe("New job and opening a project", () => {
  const pinned: ComposerDefaults = { mode: "reference-to-video", model: "seedance-2-5", settings: runSettings, pinned: true };
  const draft: ComposerDraft = { prompt: "scene text", mode: "image-to-image", model: "seedream-5-0", settings: otherSettings };
  const project = { prompt: "brief prompt", lookIds: ["look-1"], draft, defaults: pinned };

  it("New job starts from the brief with the project model and marks the composer as a new job", () => {
    expect(composerStateForNewJob(project)).toEqual({
      prompt: "brief prompt",
      lookIds: ["look-1"],
      defaults: pinned,
      origin: "new-job",
    });
  });

  it("opening brings the draft text back but keeps the pinned model", () => {
    expect(composerStateOnOpen(project)).toEqual({
      prompt: "scene text",
      lookIds: ["look-1"],
      defaults: pinned,
      origin: "draft",
    });
  });

  it("opening with a draft on the pinned model keeps the draft's settings", () => {
    const sameModelDraft: ComposerDraft = { ...draft, mode: "reference-to-video", model: "seedance-2-5" };
    expect(composerStateOnOpen({ ...project, draft: sameModelDraft }).defaults).toEqual({ ...pinned, settings: otherSettings });
  });

  it("opening without a pin follows the draft's model", () => {
    const unpinned: ComposerDefaults = { mode: "reference-to-video", model: "seedance-2-5", settings: runSettings };
    expect(composerStateOnOpen({ ...project, defaults: unpinned })).toEqual({
      prompt: "scene text",
      lookIds: ["look-1"],
      defaults: { mode: "image-to-image", model: "seedream-5-0", settings: otherSettings },
      origin: "draft",
    });
  });

  it("opening with no draft is a new job", () => {
    expect(composerStateOnOpen({ ...project, draft: null })).toEqual({
      prompt: "brief prompt",
      lookIds: ["look-1"],
      defaults: pinned,
      origin: "new-job",
    });
  });
});
