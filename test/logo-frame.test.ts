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

  it("keeps a wide glyph whole inside the circle", async () => {
    const width = 64;
    const height = 64;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const glyph = x >= 8 && x < 56 && y >= 26 && y < 38;
        rgba[i] = glyph ? 255 : 32;
        rgba[i + 1] = glyph ? 255 : 180;
        rgba[i + 2] = glyph ? 255 : 196;
        rgba[i + 3] = 255;
      }
    }
    const framed = await frameLogoPng(await encodePng({ width, height, rgba }));
    const image = await decodePng(framed!);
    expect(image).toBeTruthy();
    const size = image!.width;
    expect(image!.height).toBe(size);
    const cx = (size - 1) / 2;
    const cy = (size - 1) / 2;
    const radius = size / 2;
    let minX = size;
    let maxX = 0;
    let minY = size;
    let maxY = 0;
    let white = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const pixel = image!.rgba[i] ?? 0;
        const alpha = image!.rgba[i + 3] ?? 0;
        if (pixel < 240 || alpha < 250) continue;
        white += 1;
        const dx = x - cx;
        const dy = y - cy;
        expect(Math.hypot(dx, dy)).toBeLessThan(radius - 1);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    expect(white).toBeGreaterThan(500);
    expect(maxX - minX).toBeGreaterThan(maxY - minY);
    expect(minX).toBeGreaterThan(2);
    expect(minY).toBeGreaterThan(2);
    expect(image!.rgba[3]).toBe(0);
  });
});
