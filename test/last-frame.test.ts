import { describe, expect, it } from "vitest";
import { buildEnqueuePayload } from "../worker/oxen";
import {
  captureLastFrameRequested,
  generationParamsForStorage,
  rejectLastFrameUpload,
  sniffImageContentType,
} from "../worker/last-frame";
import { lastFrameSeekTime } from "../src/lib/last-frame";

describe("studio last frame", () => {
  it("stores the capture flag without adding an Oxen field", () => {
    const payload = buildEnqueuePayload("video", {
      model: "bytedance-seedance-2-5-text-to-video",
      prompt: "a kite",
      duration: 5,
    });
    expect(payload).not.toHaveProperty("capture_last_frame");
    expect(payload).not.toHaveProperty("return_last_frame");
    expect(payload).not.toHaveProperty("tail_image_url");
    const stored = JSON.parse(generationParamsForStorage(payload, true)) as {
      capture_last_frame?: boolean;
      return_last_frame?: boolean;
    };
    expect(stored.capture_last_frame).toBe(true);
    expect(stored.return_last_frame).toBeUndefined();
    expect(captureLastFrameRequested(generationParamsForStorage(payload, false))).toBe(false);
  });

  it("rejects a frame when the generation did not ask for one", () => {
    expect(
      rejectLastFrameUpload({
        mediaType: "video",
        status: "succeeded",
        paramsJson: JSON.stringify({ prompt: "a kite" }),
        contentType: "image/jpeg",
        size: 120,
      }),
    ).toMatch(/did not ask/);
    expect(
      rejectLastFrameUpload({
        mediaType: "video",
        status: "succeeded",
        paramsJson: JSON.stringify({ capture_last_frame: true }),
        contentType: "image/jpeg",
        size: 120,
      }),
    ).toBeNull();
    expect(sniffImageContentType(new Uint8Array([0xff, 0xd8, 0xff]), "")).toBe("image/jpeg");
  });

  it("seeks just before the end of a finite video", () => {
    expect(lastFrameSeekTime(0)).toBe(0);
    expect(lastFrameSeekTime(Number.NaN)).toBe(0);
    expect(lastFrameSeekTime(2)).toBeCloseTo(2 - 1 / 30);
  });
});
