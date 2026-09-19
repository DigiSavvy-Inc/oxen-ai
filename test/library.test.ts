import { describe, expect, it } from "vitest";
import { parseCleanupAction } from "../worker/library";
import { createImageThumbnail, isRasterImage } from "../worker/thumbs";

describe("library cleanup", () => {
  it("accepts failed and thumbs actions", () => {
    expect(parseCleanupAction("failed")).toBe("failed");
    expect(parseCleanupAction("thumbs")).toBe("thumbs");
    expect(parseCleanupAction("all")).toBeNull();
  });
});

describe("thumbnails", () => {
  it("only resizes raster images when an Images binding exists", async () => {
    expect(isRasterImage("image/png")).toBe(true);
    expect(isRasterImage("video/mp4")).toBe(false);
    expect(await createImageThumbnail(undefined, new ArrayBuffer(8), "image/png")).toBeNull();
  });
});
