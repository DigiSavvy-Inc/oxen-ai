import { describe, expect, it } from "vitest";
import { parseCleanupAction, thumbIsReusable } from "../worker/library";
import { createImageThumbnail, isRasterImage, THUMB_MAX_BYTES } from "../worker/thumbs";

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

  it("skips R2 HEADs for thumbs that already exist unless rebuilding oversized files", () => {
    expect(thumbIsReusable({ size: 400_000 }, false)).toBe(true);
    expect(thumbIsReusable({ size: 400_000 }, true)).toBe(false);
    expect(thumbIsReusable({ size: THUMB_MAX_BYTES }, true)).toBe(true);
    expect(thumbIsReusable(null, false)).toBe(false);
  });
});
