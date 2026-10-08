import { describe, expect, it } from "vitest";
import { decodePng, encodePng, frameLogoPng } from "../worker/logo-frame";

describe("frameLogoPng", () => {
  it("crops the tile padding and masks the mark to a circle", async () => {
    const width = 48;
    const height = 48;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const glyph = x >= 18 && x < 30 && y >= 18 && y < 30;
        rgba[i] = glyph ? 255 : 32;
        rgba[i + 1] = glyph ? 255 : 180;
        rgba[i + 2] = glyph ? 255 : 196;
        rgba[i + 3] = 255;
      }
    }
    const source = await encodePng({ width, height, rgba });
    const framed = await frameLogoPng(source);
    expect(framed).toBeTruthy();
    const image = await decodePng(framed!);
    expect(image).toBeTruthy();
    expect(image!.width).toBeLessThan(30);
    expect(image!.height).toBe(image!.width);
    const size = image!.width;
    const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    expect(image!.rgba[center]).toBeGreaterThan(240);
    expect(image!.rgba[center + 3]).toBe(255);
    expect(image!.rgba[3]).toBe(0);
    const top = Math.floor(size / 2) * 4;
    expect(image!.rgba[top + 3]).toBeGreaterThan(200);
  });
});
