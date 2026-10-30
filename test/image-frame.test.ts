import { describe, expect, it } from "vitest";
import { fittedImageSize, SEEDANCE_IMAGE_RATIO } from "../worker/image-frame";

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
