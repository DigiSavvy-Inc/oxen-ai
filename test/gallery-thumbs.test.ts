import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  galleryPreviewIsImage,
  gallerySlotSrc,
  galleryThumbWidth,
} from "../src/lib/gallery-thumbs";
import { GALLERY_SERVE_WIDTHS, parseServedThumbWidth } from "../worker/gallery-thumbs";

describe("gallery slot thumbs", () => {
  it("asks Studio media for a slot width and leaves other urls alone", () => {
    const signed = "https://studio.digisavvy.dev/api/media/u/user-1/thumbs/a.avif?exp=1&sig=abc";
    const tile = new URL(gallerySlotSrc(signed, "tile"));
    expect(tile.searchParams.get("w")).toBe(String(galleryThumbWidth("tile")));
    expect(tile.searchParams.get("sig")).toBe("abc");
    expect(gallerySlotSrc("/api/media/u/user-1/a.png?exp=2&sig=z", "strip")).toBe(
      `/api/media/u/user-1/a.png?exp=2&sig=z&w=${galleryThumbWidth("strip")}`,
    );
    expect(gallerySlotSrc("data:image/png;base64,aaaa", "strip")).toBe("data:image/png;base64,aaaa");
    expect(gallerySlotSrc("https://hub.oxen.ai/file.png", "cover")).toBe("https://hub.oxen.ai/file.png");
  });

  it("does not treat a video file as a thumbnail", () => {
    expect(galleryPreviewIsImage("https://studio.digisavvy.dev/api/media/u/1/clip.mp4?exp=1")).toBe(false);
    expect(galleryPreviewIsImage("https://studio.digisavvy.dev/api/media/u/1/thumbs/a.avif?exp=1")).toBe(true);
    expect(galleryPreviewIsImage("data:image/jpeg;base64,aa")).toBe(true);
    expect(galleryPreviewIsImage("data:video/mp4;base64,aa")).toBe(false);
  });

  it("only serves the slot widths, not the 256px library thumb", () => {
    for (const slot of ["strip", "tile", "cover"] as const) {
      expect(GALLERY_SERVE_WIDTHS).toContain(galleryThumbWidth(slot));
    }
    expect(parseServedThumbWidth("96")).toBe(96);
    expect(parseServedThumbWidth("160")).toBe(160);
    expect(parseServedThumbWidth("256")).toBeNull();
    expect(parseServedThumbWidth("48")).toBeNull();
  });

  it("renders gallery slots from GalleryThumb instead of the full file", () => {
    const drawer = readFileSync(new URL("../src/components/GalleryDrawer.tsx", import.meta.url), "utf8");
    const palette = readFileSync(new URL("../src/components/CreateGalleryPalette.tsx", import.meta.url), "utf8");
    const browser = readFileSync(new URL("../src/components/GalleryBrowser.tsx", import.meta.url), "utf8");
    expect(drawer).toContain('slot="tile"');
    expect(drawer).not.toContain("<video");
    expect(palette).toContain('slot="strip"');
    expect(palette).not.toContain("<video");
    expect(browser).toContain('"strip"');
    expect(browser).toContain('"cover"');
    expect(browser).toContain('slot="tile"');
    expect(browser).toContain("Attach all");
    expect(browser).toContain("click to upload");
    expect(browser).toContain("Add media to");
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toContain("64px * 3 + 4px * 2");
    expect(browser).toContain("onAttach([item])");
    expect(browser).toContain("Feature");
  });
});
