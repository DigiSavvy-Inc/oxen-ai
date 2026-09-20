import { afterEach, describe, expect, it } from "vitest";
import {
  POLL_FAILURE_THRESHOLD,
  buildEnqueuePayload,
  enqueueGeneration,
  extractResultUrl,
  filterModelsForMode,
  isMediaGenerationModel,
  notePollFailure,
  paramsJsonForStorage,
  redactStoredMediaRef,
  resetPollFailures,
  shouldPersistPollFailure,
  type OxenModel,
} from "../worker/oxen";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ids(models: OxenModel[]): string[] {
  return models.map((model) => model.id);
}

const catalog: OxenModel[] = [
  {
    id: "flux-prefixed",
    endpoint: "/api/ai/images/generate",
    capabilities: { input: ["text"], output: ["image"] },
  },
  {
    id: "flux-bare",
    endpoint: "images/generate",
    capabilities: { input: ["text"], output: ["image"] },
  },
  {
    id: "flux-optional-image",
    endpoint: "/images/generate",
    capabilities: { input: ["text", "image"], output: ["image"] },
  },
  {
    id: "gpt-image-2-5-flare",
    endpoint: "/images/edit",
    capabilities: { input: ["text", "image"], output: ["image"] },
  },
  {
    id: "gpt-image-2-5-sunburst",
    endpoint: "/images/edit",
    capabilities: { input: ["text", "image"], output: ["image"] },
  },
  {
    id: "qwen-edit",
    endpoint: "/api/ai/images/edit",
    capabilities: { input: ["text", "image"], output: ["image"] },
  },
  {
    id: "flux-no-caps",
    endpoint: "https://hub.oxen.ai/api/ai/images/generate",
  },
  {
    id: "kling-t2v",
    endpoint: "/api/ai/videos/generate",
    capabilities: { input: ["text"], output: ["video"] },
  },
  {
    id: "kling-ref",
    endpoint: "videos/generate",
    capabilities: { input: ["text", "image"], output: ["video"] },
  },
  {
    id: "kling-v2v",
    endpoint: "/videos/generate",
    capabilities: { input: ["text", "video", "image"], output: ["video"] },
  },
  {
    id: "claude-chat",
    endpoint: "/chat/completions",
    capabilities: { input: ["text", "image"], output: ["text"] },
  },
];

describe("enqueueGeneration error mapping", () => {
  it("maps nested Oxen error.detail on HTTP failure", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        { error: { type: "invalid_request", detail: "num_generations must be an integer between 1 and 4" } },
        400,
      );

    await expect(enqueueGeneration("test-key", { model: "flux", prompt: "x" })).rejects.toThrow(
      "num_generations must be an integer between 1 and 4",
    );
  });

  it("maps error.message, then title, then status_message", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ error: { message: "Model not found: nope" } }, 404);
    await expect(enqueueGeneration("test-key", { model: "nope", prompt: "x" })).rejects.toThrow(
      "Model not found: nope",
    );

    globalThis.fetch = async () =>
      jsonResponse(
        { error: { title: "The requested resource could not be found" }, status: "error" },
        404,
      );
    await expect(enqueueGeneration("test-key", { model: "nope", prompt: "x" })).rejects.toThrow(
      "The requested resource could not be found",
    );

    globalThis.fetch = async () =>
      jsonResponse({ status: "error", status_message: "unauthenticated" }, 401);
    await expect(enqueueGeneration("test-key", { model: "flux", prompt: "x" })).rejects.toThrow(
      "unauthenticated",
    );
  });

  it("fails clearly when Oxen returns an empty generations array", async () => {
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe("https://hub.oxen.ai/api/ai/queue");
      return jsonResponse({ generations: [] });
    };

    await expect(
      enqueueGeneration("test-key", { model: "flux", prompt: "a cube" }),
    ).rejects.toThrow("Oxen enqueue returned no generations");
  });

  it("uses Oxen's error payload when the generations list is empty", async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        generations: [],
        error: { detail: "unsupported_media_type" },
      });

    await expect(
      enqueueGeneration("test-key", { model: "claude-sonnet-4-6", prompt: "hi" }),
    ).rejects.toThrow("unsupported_media_type");
  });

  it("returns queued generation ids from POST /api/ai/queue", async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        generations: [{ generation_id: "gen-1", status: "queued" }],
      });

    const generations = await enqueueGeneration("test-key", {
      model: "black-forest-labs-flux-2-klein-4b",
      prompt: "a cube",
    });
    expect(generations).toEqual([{ generation_id: "gen-1", status: "queued" }]);
  });
});

describe("extractResultUrl", () => {
  it("prefers Oxen result_url on succeeded jobs", () => {
    expect(
      extractResultUrl({
        status: "succeeded",
        result_url: "https://hub.oxen.ai/api/repos/result.png",
        images: [{ url: "https://example.com/fallback.png" }],
      }),
    ).toBe("https://hub.oxen.ai/api/repos/result.png");
  });

  it("falls back to images[0].url when result_url is empty", () => {
    expect(
      extractResultUrl({
        result_url: "",
        images: [{ url: "https://hub.oxen.ai/api/repos/image.png" }],
      }),
    ).toBe("https://hub.oxen.ai/api/repos/image.png");
  });

  it("falls back to videos[0].url", () => {
    expect(
      extractResultUrl({
        result_url: null,
        videos: [{ url: "https://hub.oxen.ai/api/repos/clip.mp4" }],
      }),
    ).toBe("https://hub.oxen.ai/api/repos/clip.mp4");
  });

  it("falls back to video.url, image.url, then nested result.url", () => {
    expect(
      extractResultUrl({
        video: { url: "https://hub.oxen.ai/api/repos/single.mp4" },
      }),
    ).toBe("https://hub.oxen.ai/api/repos/single.mp4");
    expect(
      extractResultUrl({
        image: { url: "https://hub.oxen.ai/api/repos/single.png" },
      }),
    ).toBe("https://hub.oxen.ai/api/repos/single.png");
    expect(
      extractResultUrl({
        result: { url: "https://hub.oxen.ai/api/repos/nested.webp" },
      }),
    ).toBe("https://hub.oxen.ai/api/repos/nested.webp");
  });

  it("returns null when no result URL is present", () => {
    expect(extractResultUrl({ status: "processing", result_url: null })).toBeNull();
  });
});

describe("filterModelsForMode", () => {
  it("matches text-to-image when endpoint strings vary", () => {
    expect(ids(filterModelsForMode(catalog, "text-to-image")).sort()).toEqual([
      "flux-bare",
      "flux-no-caps",
      "flux-optional-image",
      "flux-prefixed",
      "gpt-image-2-5-flare",
      "gpt-image-2-5-sunburst",
    ]);
  });

  it("matches image-to-image for edit and generate endpoints", () => {
    expect(ids(filterModelsForMode(catalog, "image-to-image")).sort()).toEqual([
      "flux-no-caps",
      "flux-optional-image",
      "gpt-image-2-5-flare",
      "gpt-image-2-5-sunburst",
      "qwen-edit",
    ]);
  });

  it("matches video modes from prefixed and bare endpoints", () => {
    expect(ids(filterModelsForMode(catalog, "text-to-video"))).toEqual(["kling-t2v"]);
    expect(ids(filterModelsForMode(catalog, "reference-to-video"))).toEqual([
      "kling-ref",
      "kling-v2v",
    ]);
    expect(ids(filterModelsForMode(catalog, "video-to-video"))).toEqual(["kling-v2v"]);
  });

  it("keeps Seedance 2.5 reference models in Image → Video even when they also accept video", () => {
    const seedanceRef: OxenModel = {
      id: "bytedance-seedance-2-5-reference-to-video",
      display_name: "Seedance 2.5 Reference-to-Video",
      endpoint: "/videos/generate",
      capabilities: { input: ["text", "image", "video", "audio"], output: ["video"] },
    };
    const seedanceT2v: OxenModel = {
      id: "bytedance-seedance-2-5-text-to-video",
      endpoint: "/videos/generate",
      capabilities: { input: ["text"], output: ["video"] },
    };
    const seedanceI2v: OxenModel = {
      id: "bytedance-seedance-2-5-image-to-video",
      endpoint: "/videos/generate",
      capabilities: { input: ["text", "image"], output: ["video"] },
    };
    const klingMotion: OxenModel = {
      id: "kling-video-v3-pro-motion-control",
      endpoint: "/videos/generate",
      capabilities: { input: ["text", "image", "video"], output: ["video"] },
    };
    const wan: OxenModel = {
      id: "wan-3-0",
      endpoint: "/videos/generate",
      capabilities: { input: ["text"], output: ["video"] },
    };
    const models = [seedanceRef, seedanceT2v, seedanceI2v, klingMotion, wan];

    expect(ids(filterModelsForMode(models, "text-to-video")).sort()).toEqual([
      "bytedance-seedance-2-5-text-to-video",
      "wan-3-0",
    ]);
    expect(ids(filterModelsForMode(models, "reference-to-video")).sort()).toEqual([
      "bytedance-seedance-2-5-image-to-video",
      "bytedance-seedance-2-5-reference-to-video",
      "kling-video-v3-pro-motion-control",
      "wan-3-0",
    ]);
    expect(ids(filterModelsForMode(models, "video-to-video")).sort()).toEqual([
      "bytedance-seedance-2-5-reference-to-video",
      "kling-video-v3-pro-motion-control",
    ]);
  });

  it("does not classify chat models as media models", () => {
    for (const mode of [
      "text-to-image",
      "image-to-image",
      "text-to-video",
      "reference-to-video",
      "video-to-video",
    ] as const) {
      expect(filterModelsForMode(catalog, mode).some((m) => m.id === "claude-chat")).toBe(false);
    }
  });

  it("keeps image and video models when listing without a mode", () => {
    expect(catalog.filter(isMediaGenerationModel).some((model) => model.id === "claude-chat")).toBe(
      false,
    );
    expect(ids(catalog.filter(isMediaGenerationModel)).sort()).toEqual(
      ids(catalog.filter((model) => model.id !== "claude-chat")).sort(),
    );
  });

  it("leaves an empty live list empty so callers can keep fallback models", () => {
    const filtered = filterModelsForMode([], "text-to-image");
    expect(filtered).toEqual([]);
    const fallback: OxenModel[] = [
      {
        id: "black-forest-labs-flux-2-klein-4b",
        endpoint: "/images/generate",
        capabilities: { input: ["text"], output: ["image"] },
      },
    ];
    const models = filtered.length > 0 ? filtered : fallback;
    expect(models[0]?.id).toBe("black-forest-labs-flux-2-klein-4b");
  });
});

describe("buildEnqueuePayload", () => {
  it("does not send video-only fields on image jobs", () => {
    const payload = buildEnqueuePayload("image", {
      model: "flux",
      prompt: "a cube",
      duration: 5,
      generate_audio: true,
      input_video: "https://example.com/clip.mp4",
      aspect_ratio: "1:1",
    });
    expect("duration" in payload).toBe(false);
    expect("generate_audio" in payload).toBe(false);
    expect("input_video" in payload).toBe(false);
    expect(payload.aspect_ratio).toBe("1:1");
  });

  it("includes duration only for video jobs", () => {
    const payload = buildEnqueuePayload("video", {
      model: "kling-video-v2-6-pro-text-to-video",
      prompt: "waves",
      duration: 5,
      generate_audio: false,
    });
    expect(payload.duration).toBe(5);
    expect(payload.generate_audio).toBe(false);
  });

  it("includes Seedance input_images on video jobs", () => {
    const payload = buildEnqueuePayload("video", {
      model: "bytedance-seedance-2-0-reference-to-video",
      prompt: "@Image1 waves",
      input_images: ["https://example.com/a.png"],
      duration: "8",
      num_generations: 2,
    });
    expect(payload.input_images).toEqual(["https://example.com/a.png"]);
    expect(payload.duration).toBe("8");
    expect(payload.num_generations).toBe(2);
    expect("input_image" in payload).toBe(false);
  });

  it("redacts data URIs before storing Seedance params in D1", () => {
    const dataUri = `data:image/png;base64,${"A".repeat(5000)}`;
    const json = paramsJsonForStorage({
      model: "bytedance-seedance-2-5-reference-to-video",
      prompt: "@Image1 walk",
      input_images: [dataUri, "https://studio.digisavvy.dev/api/media/a.png"],
      input_audios: [`data:audio/mpeg;base64,${"B".repeat(3000)}`],
    });
    const stored = JSON.parse(json) as {
      input_images: string[];
      input_audios: string[];
      prompt: string;
    };
    expect(json.length).toBeLessThan(2000);
    expect(stored.prompt).toBe("@Image1 walk");
    expect(stored.input_images[0]).toBe(redactStoredMediaRef(dataUri));
    expect(stored.input_images[0]?.includes("omitted")).toBe(true);
    expect(stored.input_images[1]).toBe("https://studio.digisavvy.dev/api/media/a.png");
    expect(stored.input_audios[0]?.startsWith("data:audio/mpeg;base64,<omitted")).toBe(true);
  });

  it("sends Seedream size instead of resolution when provided", () => {
    const payload = buildEnqueuePayload("image", {
      model: "bytedance-seedream-5-pro",
      prompt: "a cat",
      size: "2K",
      aspect_ratio: "1:1",
    });
    expect(payload.size).toBe("2K");
    expect("resolution" in payload).toBe(false);
  });
});

describe("poll failure threshold", () => {
  it("ignores transient failures until the threshold", () => {
    resetPollFailures("gen-a");
    expect(shouldPersistPollFailure(notePollFailure("gen-a"))).toBe(false);
    expect(shouldPersistPollFailure(notePollFailure("gen-a"))).toBe(false);
    expect(shouldPersistPollFailure(notePollFailure("gen-a"))).toBe(true);
    expect(POLL_FAILURE_THRESHOLD).toBe(3);
    resetPollFailures("gen-a");
  });
});
