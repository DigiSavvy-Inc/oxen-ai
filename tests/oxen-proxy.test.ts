import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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
} from "../worker/oxen.ts";

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

    await assert.rejects(
      () => enqueueGeneration("test-key", { model: "flux", prompt: "x" }),
      { message: "num_generations must be an integer between 1 and 4" },
    );
  });

  it("maps error.message, then title, then status_message", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ error: { message: "Model not found: nope" } }, 404);
    await assert.rejects(
      () => enqueueGeneration("test-key", { model: "nope", prompt: "x" }),
      { message: "Model not found: nope" },
    );

    globalThis.fetch = async () =>
      jsonResponse(
        { error: { title: "The requested resource could not be found" }, status: "error" },
        404,
      );
    await assert.rejects(
      () => enqueueGeneration("test-key", { model: "nope", prompt: "x" }),
      { message: "The requested resource could not be found" },
    );

    globalThis.fetch = async () =>
      jsonResponse({ status: "error", status_message: "unauthenticated" }, 401);
    await assert.rejects(
      () => enqueueGeneration("test-key", { model: "flux", prompt: "x" }),
      { message: "unauthenticated" },
    );
  });

  it("fails clearly when Oxen returns an empty generations array", async () => {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://hub.oxen.ai/api/ai/queue");
      return jsonResponse({ generations: [] });
    };

    await assert.rejects(
      () => enqueueGeneration("test-key", { model: "flux", prompt: "a cube" }),
      { message: "Oxen enqueue returned no generations" },
    );
  });

  it("uses Oxen's error payload when the generations list is empty", async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        generations: [],
        error: { detail: "unsupported_media_type" },
      });

    await assert.rejects(
      () => enqueueGeneration("test-key", { model: "claude-sonnet-4-6", prompt: "hi" }),
      { message: "unsupported_media_type" },
    );
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
    assert.deepEqual(generations, [{ generation_id: "gen-1", status: "queued" }]);
  });
});

describe("extractResultUrl", () => {
  it("prefers Oxen result_url on succeeded jobs", () => {
    assert.equal(
      extractResultUrl({
        status: "succeeded",
        result_url: "https://hub.oxen.ai/api/repos/result.png",
        images: [{ url: "https://example.com/fallback.png" }],
      }),
      "https://hub.oxen.ai/api/repos/result.png",
    );
  });

  it("falls back to images[0].url when result_url is empty", () => {
    assert.equal(
      extractResultUrl({
        result_url: "",
        images: [{ url: "https://hub.oxen.ai/api/repos/image.png" }],
      }),
      "https://hub.oxen.ai/api/repos/image.png",
    );
  });

  it("falls back to videos[0].url", () => {
    assert.equal(
      extractResultUrl({
        result_url: null,
        videos: [{ url: "https://hub.oxen.ai/api/repos/clip.mp4" }],
      }),
      "https://hub.oxen.ai/api/repos/clip.mp4",
    );
  });

  it("returns null when no result URL is present", () => {
    assert.equal(extractResultUrl({ status: "processing", result_url: null }), null);
  });
});

describe("filterModelsForMode", () => {
  it("matches text-to-image when endpoint strings vary", () => {
    assert.deepEqual(ids(filterModelsForMode(catalog, "text-to-image")).sort(), [
      "flux-bare",
      "flux-no-caps",
      "flux-optional-image",
      "flux-prefixed",
    ]);
  });

  it("matches image-to-image for edit and generate endpoints", () => {
    assert.deepEqual(ids(filterModelsForMode(catalog, "image-to-image")).sort(), [
      "flux-no-caps",
      "flux-optional-image",
      "qwen-edit",
    ]);
  });

  it("matches video modes from prefixed and bare endpoints", () => {
    assert.deepEqual(ids(filterModelsForMode(catalog, "text-to-video")), ["kling-t2v"]);
    assert.deepEqual(ids(filterModelsForMode(catalog, "reference-to-video")), ["kling-ref"]);
    assert.deepEqual(ids(filterModelsForMode(catalog, "video-to-video")), ["kling-v2v"]);
  });

  it("does not classify chat models as media models", () => {
    for (const mode of [
      "text-to-image",
      "image-to-image",
      "text-to-video",
      "reference-to-video",
      "video-to-video",
    ] as const) {
      assert.equal(filterModelsForMode(catalog, mode).some((m) => m.id === "claude-chat"), false);
    }
  });

  it("leaves an empty live list empty so callers can keep fallback models", () => {
    const filtered = filterModelsForMode([], "text-to-image");
    assert.deepEqual(filtered, []);
    const fallback: OxenModel[] = [
      {
        id: "black-forest-labs-flux-2-klein-4b",
        endpoint: "/images/generate",
        capabilities: { input: ["text"], output: ["image"] },
      },
    ];
    const models = filtered.length > 0 ? filtered : fallback;
    assert.equal(models[0]?.id, "black-forest-labs-flux-2-klein-4b");
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
    assert.equal("duration" in payload, false);
    assert.equal("generate_audio" in payload, false);
    assert.equal("input_video" in payload, false);
    assert.equal(payload.aspect_ratio, "1:1");
  });

  it("includes duration only for video jobs", () => {
    const payload = buildEnqueuePayload("video", {
      model: "kling-video-v2-6-pro-text-to-video",
      prompt: "waves",
      duration: 5,
      generate_audio: false,
    });
    assert.equal(payload.duration, 5);
    assert.equal(payload.generate_audio, false);
  });
});

describe("poll failure threshold", () => {
  it("ignores transient failures until the threshold", () => {
    resetPollFailures("gen-a");
    assert.equal(shouldPersistPollFailure(notePollFailure("gen-a")), false);
    assert.equal(shouldPersistPollFailure(notePollFailure("gen-a")), false);
    assert.equal(
      shouldPersistPollFailure(notePollFailure("gen-a")),
      true,
    );
    assert.equal(POLL_FAILURE_THRESHOLD, 3);
    resetPollFailures("gen-a");
  });
});
