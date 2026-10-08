import { afterEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { createEnv, TEST_SECRET, TEST_SESSION_ID, TEST_USER } from "./helpers";
import type { UserRow } from "../worker/types";
import { flux3VideoModel } from "../worker/flux-video";
import {
  POLL_FAILURE_THRESHOLD,
  buildEnqueuePayload,
  downloadOxenResult,
  enqueueGeneration,
  extractResultUrl,
  filterModelsForMode,
  presentGenerationError,
  isMediaGenerationModel,
  notePollFailure,
  paramsJsonForStorage,
  redactStoredMediaRef,
  resetModelDetailCache,
  resetPollFailures,
  shouldPersistPollFailure,
  type OxenModel,
} from "../worker/oxen";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetModelDetailCache();
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

  it("keeps Flux 3 Video on text, image, and continuation modes of one id", () => {
    const flux: OxenModel = {
      id: "flux-3-video",
      display_name: "FLUX 3 Video",
      endpoint: "/videos/generate",
      capabilities: { input: ["text", "image", "video"], output: ["video"] },
    };
    expect(ids(filterModelsForMode([flux], "text-to-video"))).toEqual(["flux-3-video"]);
    expect(ids(filterModelsForMode([flux], "reference-to-video"))).toEqual(["flux-3-video"]);
    expect(ids(filterModelsForMode([flux], "video-to-video"))).toEqual(["flux-3-video"]);
    expect(filterModelsForMode([flux], "text-to-image")).toEqual([]);
    expect(filterModelsForMode([flux], "image-to-image")).toEqual([]);
    expect(filterModelsForMode([flux], "text-to-audio")).toEqual([]);
    expect(
      filterModelsForMode(
        [{ id: "flux-3-image-to-video", endpoint: "/videos/generate", capabilities: { input: ["text"], output: ["video"] } }],
        "reference-to-video",
      ),
    ).toEqual([]);
  });

  it("does not classify chat models as media models", () => {
    for (const mode of [
      "text-to-image",
      "image-to-image",
      "text-to-video",
      "reference-to-video",
      "video-to-video",
      "text-to-audio",
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
      aspect_ratio: "9:16",
      duration: "8",
      num_generations: 2,
    });
    expect(payload.input_images).toEqual(["https://example.com/a.png"]);
    expect(payload.aspect_ratio).toBe("9:16");
    expect(payload.duration).toBe("8");
    expect(payload.num_generations).toBe(2);
    expect("input_image" in payload).toBe(false);
  });

  it("includes Seedance face image fields on video jobs", () => {
    const payload = buildEnqueuePayload("video", {
      model: "bytedance-seedance-2-5-reference-to-video",
      prompt: "@Image1 waves",
      input_face_images: ["https://hub.oxen.ai/api/repos/a.png"],
      duration: 4,
    });
    expect(payload.input_face_images).toEqual(["https://hub.oxen.ai/api/repos/a.png"]);
    expect("input_images" in payload).toBe(false);
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

  it("enqueues Seed Audio on the async queue with the catalog fields and no reference", () => {
    const bare = buildEnqueuePayload("audio", {
      model: "bytedance-seed-audio-1-0",
      prompt: "rain on a tin roof",
      aspect_ratio: "1:1",
      duration: 5,
      generate_audio: true,
      input_video: "https://example.com/clip.mp4",
    });
    expect(bare).toEqual({
      model: "bytedance-seed-audio-1-0",
      prompt: "rain on a tin roof",
      num_generations: 1,
    });

    const withRefs = buildEnqueuePayload("audio", {
      model: "bytedance-seed-audio-1-0",
      prompt: "@Audio1 says hello",
      audio_urls: ["https://studio.example/voice.mp3"],
      output_format: "mp3",
      sample_rate: 24000,
      speed: 1,
      volume: 1,
      pitch: 0,
      num_generations: 2,
    });
    expect(withRefs).toEqual({
      model: "bytedance-seed-audio-1-0",
      prompt: "@Audio1 says hello",
      num_generations: 2,
      audio_urls: ["https://studio.example/voice.mp3"],
      output_format: "mp3",
      sample_rate: 24000,
      speed: 1,
      volume: 1,
      pitch: 0,
    });
    expect(withRefs).not.toHaveProperty("image_url");
  });

  it("keeps Seed Audio 1.0 on text-to-audio", () => {
    const seed = {
      id: "bytedance-seed-audio-1-0",
      display_name: "Seed Audio 1.0",
      endpoint: "/audio/generate",
      capabilities: { input: ["text", "audio", "image"], output: ["audio"] },
    };
    expect(ids(filterModelsForMode([seed, ...catalog], "text-to-audio"))).toEqual([
      "bytedance-seed-audio-1-0",
    ]);
    expect(filterModelsForMode([seed], "text-to-image")).toEqual([]);
    expect(isMediaGenerationModel(seed)).toBe(true);
  });

  it("sends Flux 3 Video keyframes, continuation, and the permissive safety default", () => {
    const frames = buildEnqueuePayload("video", {
      model: "flux-3-video",
      prompt: "a lighthouse at dawn",
      input_image: ["https://frames.example/a.png", "https://frames.example/b.png"],
      aspect_ratio: "16:9",
      resolution: "1080p",
      duration: 8,
      generate_audio: true,
      draft: false,
      safety_tolerance: 4,
      num_generations: 1,
    });
    expect(frames).toEqual({
      model: "flux-3-video",
      prompt: "a lighthouse at dawn",
      num_generations: 1,
      input_image: ["https://frames.example/a.png", "https://frames.example/b.png"],
      aspect_ratio: "16:9",
      resolution: "1080p",
      duration: 8,
      generate_audio: true,
      draft: false,
      safety_tolerance: 4,
    });
    expect(frames).not.toHaveProperty("input_audio");
    expect(frames).not.toHaveProperty("input_audios");
    expect(frames).not.toHaveProperty("input_video");

    const continuation = buildEnqueuePayload("video", {
      model: "flux-3-video",
      prompt: "the keeper keeps climbing",
      input_video: "https://frames.example/clip.mp4",
      aspect_ratio: "auto",
      resolution: "720p",
      duration: 5,
      generate_audio: true,
      draft: false,
      safety_tolerance: 4,
    });
    expect(continuation.input_video).toBe("https://frames.example/clip.mp4");
    expect(continuation).not.toHaveProperty("input_image");
    expect(continuation.safety_tolerance).toBe(4);
    expect(continuation.draft).toBe(false);
    expect(continuation.generate_audio).toBe(true);
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

describe("downloadOxenResult", () => {
  type Call = { url: string; auth: string | null };

  function mockFetch(routes: Record<string, () => Response>): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route();
    }) as typeof fetch;
    return calls;
  }

  // The user's Oxen key must never reach a provider CDN or a redirect target.
  it("sends the key to hub.oxen.ai but drops it after a redirect off-host", async () => {
    const calls = mockFetch({
      "https://hub.oxen.ai/api/files/out.png": () =>
        new Response(null, { status: 302, headers: { Location: "https://cdn.example/out.png" } }),
      "https://cdn.example/out.png": () =>
        new Response("png", { headers: { "Content-Type": "image/png" } }),
    });
    const result = await downloadOxenResult("sk-user", "https://hub.oxen.ai/api/files/out.png");
    expect(result.contentType).toBe("image/png");
    expect(calls).toEqual([
      { url: "https://hub.oxen.ai/api/files/out.png", auth: "Bearer sk-user" },
      { url: "https://cdn.example/out.png", auth: null },
    ]);
  });

  it("never sends the key to a non-Oxen result URL", async () => {
    const calls = mockFetch({
      "https://provider.example/v.mp4": () => new Response("mp4"),
    });
    await downloadOxenResult("sk-user", "https://provider.example/v.mp4");
    expect(calls[0]?.auth).toBeNull();
  });

  it("gives up on redirect loops", async () => {
    mockFetch({
      "https://hub.oxen.ai/loop": () =>
        new Response(null, { status: 302, headers: { Location: "/loop" } }),
    });
    await expect(downloadOxenResult("sk-user", "https://hub.oxen.ai/loop")).rejects.toThrow(
      /too many times/,
    );
  });
});

describe("presentGenerationError", () => {
  it("says the model rejected the prompt when Wan blocks text input", () => {
    expect(
      presentGenerationError(
        "Task failed: DataInspectionFailed - Green net check rejected text (input)",
      ),
    ).toBe(
      "This model rejected the prompt text. Its content check blocked the text, so edit the prompt and try again.",
    );
    expect(
      presentGenerationError(
        "DataInspectionFailed - Green net check failed for text (input): Input data may contain inappropriate content.",
      ),
    ).toBe(
      "This model rejected the prompt text. Its content check blocked the text, so edit the prompt and try again.",
    );
  });

  it("leaves image and output inspections and other failures unchanged", () => {
    expect(
      presentGenerationError("DataInspectionFailed - Green net check failed for image (input)"),
    ).toBe("DataInspectionFailed - Green net check failed for image (input)");
    expect(
      presentGenerationError("DataInspectionFailed - Green net check failed for image (output)"),
    ).toBe("DataInspectionFailed - Green net check failed for image (output)");
    expect(presentGenerationError("safety filter")).toBe("safety filter");
    expect(presentGenerationError(null)).toBeNull();
  });
});

describe("Wan 3.0 reference-to-video enqueue", () => {
  it("sends the prompt once and no other free-text fields", async () => {
    const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
    const user: UserRow = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
    const prompt = "the subject walks forward @Video1";
    const modelId = "wan-v3-0-video-prime";
    let queued: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `https://hub.oxen.ai/api/ai/models/${modelId}`) {
        return jsonResponse({
          id: modelId,
          display_name: "Wan 3.0 Prime",
          endpoint: "/videos/generate",
          capabilities: { input: ["text", "image", "video", "audio"], output: ["video"] },
          request_schema: {
            type: "object",
            required: ["prompt"],
            properties: {
              prompt: {
                type: "string",
                description: "Refer to assets as @Image 1, @Video 1, and @Audio 1.",
              },
              input_images: { type: "array", maxItems: 10, items: { type: "string" } },
              input_image: { type: "string", description: "First frame. Not a reference." },
              input_videos: { type: "array", maxItems: 5, items: { type: "string" } },
              input_audios: { type: "array", maxItems: 5, items: { type: "string" } },
              generate_audio: { type: "boolean", default: true },
              aspect_ratio: {
                type: "string",
                enum: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"],
                default: "adaptive",
              },
              resolution: { type: "string", enum: ["480P", "720P", "1080P"], default: "1080P" },
              duration: { type: "integer", minimum: 2, maximum: 30, default: 5 },
              enable_thinking: { type: "boolean", default: false },
              seed: { type: "integer" },
              watermark: { type: "boolean", default: false },
            },
          },
        });
      }
      if (url === "https://hub.oxen.ai/api/ai/queue" && init?.method === "POST") {
        queued = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ generations: [{ generation_id: "gen-wan", status: "queued" }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const res = await app.request(
      "https://studio.digisavvy.dev/api/generate",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "reference-to-video",
          model: modelId,
          prompt,
          num_generations: 1,
          aspect_ratio: "16:9",
          duration: 5,
          resolution: "720P",
          generate_audio: false,
          videos: ["https://cdn.example.com/media/clip"],
          filename: "walk-plate.mov",
          name: "walk-plate.mov",
          label: "character",
          negative_prompt: "do not send",
          text: "do not send",
          background: "studio backdrop",
          moderation: "low",
        }),
      },
      createEnv({
        DB: {
          prepare(sql: string) {
            return {
              bind(...args: unknown[]) {
                return {
                  async first() {
                    if (sql.includes("FROM sessions") && args[0] === TEST_SESSION_ID) return user;
                    return null;
                  },
                  async all() {
                    return { results: [] };
                  },
                  async run() {
                    return { success: true };
                  },
                };
              },
            };
          },
        } as unknown as D1Database,
      }),
    );

    expect(res.status).toBe(200);
    expect(queued).not.toBeNull();
    const payload = queued as unknown as Record<string, unknown>;
    expect(payload.prompt).toBe(prompt);
    expect(payload.model).toBe(modelId);
    expect(payload.input_videos).toEqual(["https://cdn.example.com/media/clip"]);
    expect(payload.aspect_ratio).toBe("16:9");
    expect(payload.resolution).toBe("720P");
    expect(payload.duration).toBe(5);
    expect(payload.generate_audio).toBe(false);
    expect(payload.num_generations).toBe(1);
    const stringKeys = Object.entries(payload)
      .filter(([, value]) => typeof value === "string")
      .map(([key]) => key)
      .sort();
    expect(stringKeys).toEqual(["aspect_ratio", "model", "prompt", "resolution"]);
    for (const key of [
      "background",
      "moderation",
      "negative_prompt",
      "text",
      "input",
      "filename",
      "name",
      "label",
      "caption",
      "input_video",
      "input_image",
      "enable_thinking",
      "watermark",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("walk-plate.mov");
    expect(serialized).not.toContain("character");
    expect(serialized).not.toContain("studio backdrop");
    expect(serialized).not.toContain("do not send");
    expect(serialized).not.toContain("low");
  });
});

describe("safety_tolerance enqueue", () => {
  function safetySchema(max: number) {
    const values: number[] = [];
    for (let n = 0; n <= max; n += 1) values.push(n);
    return {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        safety_tolerance: {
          type: "integer",
          enum: values,
          default: 2,
          description: "Safety filter strictness, 0 is strictest.",
        },
      },
    };
  }

  async function postGenerate(
    modelId: string,
    schema: Record<string, unknown> | null,
    body: Record<string, unknown>,
  ) {
    const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
    const user: UserRow = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
    let queued: Record<string, unknown> | null = null;
    const stored: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `https://hub.oxen.ai/api/ai/models/${modelId}`) {
        return jsonResponse({ id: modelId, request_schema: schema });
      }
      if (url === "https://hub.oxen.ai/api/ai/queue" && init?.method === "POST") {
        queued = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ generations: [{ generation_id: "gen-safety", status: "queued" }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const res = await app.request(
      "https://studio.digisavvy.dev/api/generate",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "text-to-image",
          model: modelId,
          prompt: "a red cube",
          num_generations: 1,
          ...body,
        }),
      },
      createEnv({
        DB: {
          prepare(sql: string) {
            return {
              bind(...args: unknown[]) {
                return {
                  async first() {
                    if (sql.includes("FROM sessions") && args[0] === TEST_SESSION_ID) return user;
                    return null;
                  },
                  async all() {
                    return { results: [] };
                  },
                  async run() {
                    for (const arg of args) {
                      if (typeof arg === "string" && arg.startsWith("{")) stored.push(arg);
                    }
                    return { success: true };
                  },
                };
              },
            };
          },
        } as unknown as D1Database,
      }),
    );
    return { res, queued, stored };
  }

  it("forwards the chosen value and stores it as a scalar", async () => {
    const { res, queued, stored } = await postGenerate("flux-3-image", safetySchema(4), {
      safety_tolerance: 1,
    });
    expect(res.status).toBe(200);
    expect(queued).toMatchObject({
      model: "flux-3-image",
      prompt: "a red cube",
      num_generations: 1,
      safety_tolerance: 1,
    });
    const params = stored.find((item) => item.includes("safety_tolerance"));
    expect(params).toBeTruthy();
    expect(params).toContain('"safety_tolerance":1');
    expect(params).not.toContain("data:");
  });

  it("uses the most permissive value when the request omits the field", async () => {
    const { res, queued } = await postGenerate("flux-deblur", safetySchema(5), {});
    expect(res.status).toBe(200);
    expect(queued?.safety_tolerance).toBe(5);
    expect(queued?.num_generations).toBe(1);
  });

  it("sends 0 when that is the chosen value", async () => {
    const { queued } = await postGenerate("flux-3-video", safetySchema(4), {
      safety_tolerance: 0,
    });
    expect(queued?.safety_tolerance).toBe(0);
  });

  it("omits safety_tolerance for a model whose schema does not include it", async () => {
    const { res, queued, stored } = await postGenerate(
      "gpt-image-2-5-flare",
      {
        type: "object",
        properties: {
          prompt: { type: "string" },
          quality: { type: "string", enum: ["low", "high"] },
        },
      },
      { safety_tolerance: 6, quality: "high" },
    );
    expect(res.status).toBe(200);
    expect(queued).not.toHaveProperty("safety_tolerance");
    expect(queued).toMatchObject({ quality: "high", num_generations: 1 });
    expect(stored.join("\n")).not.toContain("safety_tolerance");
  });
});

describe("Flux 3 Video enqueue", () => {
  async function postGenerate(body: Record<string, unknown>, queuedOut: { current: Record<string, unknown> | null }) {
    const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
    const user: UserRow = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://hub.oxen.ai/api/ai/models/flux-3-video") {
        return jsonResponse(flux3VideoModel);
      }
      if (url === "https://hub.oxen.ai/api/ai/queue" && init?.method === "POST") {
        queuedOut.current = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ generations: [{ generation_id: "gen-flux", status: "queued" }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    return app.request(
      "https://studio.digisavvy.dev/api/generate",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      createEnv({
        DB: {
          prepare(sql: string) {
            return {
              bind(...args: unknown[]) {
                return {
                  async first() {
                    if (sql.includes("FROM sessions") && args[0] === TEST_SESSION_ID) return user;
                    return null;
                  },
                  async all() {
                    return { results: [] };
                  },
                  async run() {
                    return { success: true };
                  },
                };
              },
            };
          },
        } as unknown as D1Database,
      }),
    );
  }

  it("queues keyframes with safety at 4 when the client omits it", async () => {
    const queued = { current: null as Record<string, unknown> | null };
    const res = await postGenerate(
      {
        mode: "reference-to-video",
        model: "flux-3-video",
        prompt: "a lighthouse at dawn",
        num_generations: 1,
        aspect_ratio: "16:9",
        duration: 8,
        resolution: "1080p",
        generate_audio: true,
        draft: false,
        images: ["https://cdn.example.com/frame.png"],
      },
      queued,
    );
    expect(res.status).toBe(200);
    expect(queued.current).toMatchObject({
      model: "flux-3-video",
      prompt: "a lighthouse at dawn",
      input_image: ["https://cdn.example.com/frame.png"],
      aspect_ratio: "16:9",
      resolution: "1080p",
      duration: 8,
      generate_audio: true,
      draft: false,
      safety_tolerance: 4,
      num_generations: 1,
    });
    expect(queued.current).not.toHaveProperty("input_video");
    expect(queued.current).not.toHaveProperty("input_audio");
    expect(queued.current).not.toHaveProperty("input_audios");
  });

  it("rejects keyframes combined with a continuation clip", async () => {
    const queued = { current: null as Record<string, unknown> | null };
    const res = await postGenerate(
      {
        mode: "reference-to-video",
        model: "flux-3-video",
        prompt: "keep going",
        images: ["https://cdn.example.com/frame.png"],
        videos: ["https://cdn.example.com/clip.mp4"],
        safety_tolerance: 2,
      },
      queued,
    );
    expect(res.status).toBe(400);
    expect(queued.current).toBeNull();
  });
});
