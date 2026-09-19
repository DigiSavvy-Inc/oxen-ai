import { afterEach, describe, expect, it } from "vitest";
import {
  POLL_FAILURE_THRESHOLD,
  buildEnqueuePayload,
  enqueueGeneration,
  extractResultUrl,
  filterModelsForMode,
  notePollFailure,
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
    expect(ids(filterModelsForMode(catalog, "reference-to-video"))).toEqual(["kling-ref"]);
    expect(ids(filterModelsForMode(catalog, "video-to-video"))).toEqual(["kling-v2v"]);
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
