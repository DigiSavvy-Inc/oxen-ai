import { describe, expect, it } from "vitest";
import { fittedImageSize, seedanceOutputSize, SEEDANCE_IMAGE_RATIO } from "../worker/image-frame";

describe("fittedImageSize", () => {
  it("leaves a still inside Seedance's 0.4 to 2.5 range", () => {
    expect(fittedImageSize(1920, 1080, SEEDANCE_IMAGE_RATIO)).toBeNull();
    expect(fittedImageSize(2500, 1000, SEEDANCE_IMAGE_RATIO)).toBeNull();
    expect(fittedImageSize(400, 1000, SEEDANCE_IMAGE_RATIO)).toBeNull();
  });

  it("center-crops a 3.04-wide image down to 2.5", () => {
    expect(fittedImageSize(3040, 1000, SEEDANCE_IMAGE_RATIO)).toEqual({ width: 2500, height: 1000 });
    const frame = fittedImageSize(3040, 1000, SEEDANCE_IMAGE_RATIO);
    expect(frame && frame.width / frame.height).toBeLessThanOrEqual(2.5);
  });

  it("center-crops a tall image up to 0.4", () => {
    expect(fittedImageSize(1000, 4000, SEEDANCE_IMAGE_RATIO)).toEqual({ width: 1000, height: 2500 });
    const frame = fittedImageSize(1000, 4000, SEEDANCE_IMAGE_RATIO);
    expect(frame && frame.width / frame.height).toBeGreaterThanOrEqual(0.4);
  });
});

describe("seedanceOutputSize", () => {
  it("keeps a photo that already fits", () => {
    expect(seedanceOutputSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(seedanceOutputSize(1024, 1536)).toEqual({ width: 1024, height: 1536 });
  });

  it("scales a small still up to 300px on the short edge", () => {
    expect(seedanceOutputSize(256, 256)).toEqual({ width: 300, height: 300 });
  });

  it("crops a wide frame, then scales it so the short edge stays at least 300", () => {
    expect(seedanceOutputSize(2000, 100)).toEqual({ width: 750, height: 300 });
  });

  it("scales a huge square down to 6000", () => {
    expect(seedanceOutputSize(8000, 8000)).toEqual({ width: 6000, height: 6000 });
  });
});
